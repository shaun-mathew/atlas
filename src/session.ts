import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import { z } from 'zod';
import { countries, introductionOrder } from './geography';
import { factVersion } from './facts';
import { facetSelectionSchema, matchesFacets, type FacetSelection } from './facets';

const countriesById = new Map(countries.map(country => [country.properties.id, country]));
const countryIdSchema = z.string().refine(id => countriesById.has(id));
const attemptSchema = z.object({
  countryId: countryIdSchema,
  skill: z.literal('name-to-location'),
  boundaryVersion: z.literal('natural-earth-5.1.2-50m'),
  // Answers saved before fact cards use the first published fact release.
  factVersion: z.literal(factVersion).default('2026-09-07'),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  correct: z.boolean(),
  assisted: z.boolean().default(false),
  selectedCountry: z.string().nullable(),
  answeredAt: z.iso.datetime(),
});
const legacyProgressSchema = z.object({
  version: z.literal(1),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  attempts: z.array(attemptSchema),
}).refine(state =>
  (state.attempts.length === state.cursor || state.attempts.length === state.cursor + 1)
  && (state.started || (state.cursor === 0 && state.attempts.length === 0))
  && state.attempts.every((attempt, index) => attempt.countryId === countries[index % countries.length].properties.id),
);
const questionKindSchema = z.enum(['new', 'review', 'practice', 'retry']);
const questionSchema = z.object({
  countryId: countryIdSchema,
  kind: questionKindSchema,
  assisted: z.boolean().default(false),
});
const progressSchema = z.object({
  version: z.literal(6),
  selection: facetSelectionSchema.nullable().default(null),
  readingCountryId: countryIdSchema.nullable().default(null),
  pausedQuestions: z.array(questionSchema).default([]),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  current: questionSchema.nullable(),
  attempts: z.array(attemptSchema.extend({ kind: questionKindSchema })),
}).refine(state => {
  const answer = state.attempts[state.cursor];
  return (state.attempts.length === state.cursor || state.attempts.length === state.cursor + 1)
    && (state.started || (state.cursor === 0 && state.attempts.length === 0))
    && new Set(state.pausedQuestions.map(question => question.countryId)).size === state.pausedQuestions.length
    && state.pausedQuestions.every(question => question.countryId !== state.current?.countryId)
    && (state.selection?.learning !== 'country-facts'
      || (state.readingCountryId !== null && matchesFacets(countriesById.get(state.readingCountryId)!, state.selection)))
    && (!answer || (answer.countryId === state.current?.countryId && answer.kind === state.current.kind));
});

// Earlier saves assessed diagnostic answers exactly like new learning items.
const previousKindSchema = questionKindSchema.or(z.literal('diagnostic'))
  .transform(kind => kind === 'diagnostic' ? 'new' as const : kind);
const previousProgressSchema = z.object({
  ...progressSchema.shape,
  version: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  current: questionSchema.extend({ kind: previousKindSchema }).nullable(),
  attempts: z.array(attemptSchema.extend({ kind: previousKindSchema })),
}).transform(state => progressSchema.parse({ ...state, version: 6 }));

type Attempt = z.infer<typeof progressSchema>['attempts'][number];
type Proficiency = {
  level: 'Learning' | 'Familiar' | 'Retained';
  intervalDays: number;
  dueAt: string;
};
const reviewIntervals = [1, 3, 7, 14, 30];
const day = 24 * 60 * 60 * 1000;

function initialState(): z.infer<typeof progressSchema> {
  return {
    version: 6, selection: null, readingCountryId: null, pausedQuestions: [], started: false, cursor: 0, attempts: [],
    current: { countryId: introductionOrder[0].properties.id, kind: 'new', assisted: false },
  };
}

// Attempts are the durable source of skill proficiency and scheduling state.
// Replaying them also upgrades older saves without discarding learner history.
export class GuestSession {
  private state = initialState();
  private learningItems = new Map<string, Proficiency>();
  private selectionHistory = new Map<string, { lastSeenIndex: number; weak: boolean }>();
  private introductionsSinceRevisit = 0;
  storageNotice = '';

  constructor() {
    try {
      const saved = localStorage.getItem('atlas-practice.guest');
      if (saved === null) return;
      const parsed = JSON.parse(saved);
      if (parsed.version === 1) {
        const legacy = legacyProgressSchema.parse(parsed);
        this.state = {
          ...initialState(), ...legacy, version: 6,
          current: {
            countryId: countries[legacy.cursor % countries.length].properties.id,
            kind: 'new',
            assisted: legacy.attempts[legacy.cursor]?.assisted ?? false,
          },
          attempts: legacy.attempts.map(attempt => ({ ...attempt, kind: 'new' as const })),
        };
      } else if ([2, 3, 4, 5].includes(parsed.version)) {
        this.state = previousProgressSchema.parse(parsed);
      } else {
        this.state = progressSchema.parse(parsed);
      }
      if (!this.started) this.state = initialState();
      this.attempts.forEach((attempt, index) => this.recordAttempt(attempt, index));
      const waiting = this.started && !this.state.current;
      if (waiting) this.state.current = this.selectQuestion(new Date().toISOString());
      const revealedQuestion = this.readingFacts && this.selectFactCountry(this.state.readingCountryId!);
      if (waiting || parsed.version !== 6 || revealedQuestion) this.save();
    } catch {
      this.storageNotice = 'Saved guest progress could not be read. Starting a session will replace any unreadable save. Browser storage must be available to retain new progress.';
    }
  }

  get started() { return this.state.started; }
  get cursor() { return this.state.cursor; }
  get attempts() { return this.state.attempts; }
  get readingFacts() { return this.selection?.learning === 'country-facts'; }
  get questionKind() { return this.readingFacts ? undefined : this.state.current?.kind; }
  get assisted() { return !this.readingFacts && (this.state.current?.assisted ?? false); }
  get country() {
    const id = this.readingFacts ? this.state.readingCountryId : this.state.current?.countryId;
    return id ? countriesById.get(id)! : null;
  }
  get feedback() { return this.readingFacts ? undefined : this.attempts[this.cursor]; }
  get proficiency() {
    return !this.readingFacts && this.state.current ? this.learningItems.get(`${this.state.current.countryId}:name-to-location`) : undefined;
  }
  get selection() { return this.state.selection; }

  choosePractice(selection: FacetSelection | null) {
    const nextSelection = selection === null ? null : facetSelectionSchema.parse(selection);
    if (this.started && nextSelection?.continent === this.selection?.continent
      && nextSelection?.region === this.selection?.region && nextSelection?.learning === this.selection?.learning) return;
    this.state.selection = nextSelection;
    if (this.readingFacts) {
      this.selectFactCountry(introductionOrder.find(country => matchesFacets(country, this.selection!))!.properties.id);
    } else {
      // Keep unanswered prompts (including revealed location help) until that
      // country is selected again. Switching scope must not turn help into recall.
      if (this.started && this.state.current && !this.attempts[this.cursor]) this.state.pausedQuestions.push(this.state.current);
      this.state.readingCountryId = null;
      this.state.cursor = this.attempts.length;
      this.state.current = this.selectQuestion(new Date().toISOString());
    }
    this.start();
  }

  private selectFactCountry(countryId: string): boolean {
    this.state.readingCountryId = countryId;
    // The reading map reveals location just like linked-map help. Preserve that
    // exposure on an unanswered prompt without recording an attempt or review.
    const pending = this.state.current?.countryId === countryId && !this.attempts[this.cursor]
      ? this.state.current : this.state.pausedQuestions.find(question => question.countryId === countryId);
    if (!pending || pending.assisted) return false;
    pending.assisted = true;
    return true;
  }

  reset(): boolean {
    const fresh = initialState();
    try {
      // Persist first: a failed write must leave the active session intact.
      localStorage.setItem('atlas-practice.guest', JSON.stringify(fresh));
    } catch {
      this.storageNotice = 'Learning progress could not be reset because browser storage is unavailable or full. Your existing progress has been kept.';
      return false;
    }
    this.state = fresh;
    this.learningItems.clear();
    this.selectionHistory.clear();
    this.introductionsSinceRevisit = 0;
    this.storageNotice = '';
    return true;
  }

  start() {
    this.state.started = true;
    if (!this.state.current) this.state.current = this.selectQuestion(new Date().toISOString());
    this.save();
  }


  requestLocationHelp() {
    if (!this.started || this.readingFacts || !this.state.current || this.feedback || this.assisted) return;
    this.state.current.assisted = true;
    this.save();
  }

  private save() {
    try {
      localStorage.setItem('atlas-practice.guest', JSON.stringify(this.state));
      this.storageNotice = '';
    } catch {
      this.storageNotice = 'Progress is not saved. Browser storage is unavailable or full. You can keep practicing, but new progress may be lost when you close this page.';
    }
  }

  private updateProficiency(attempt: Attempt) {
    // Immediate retries and extra practice do not measure scheduled retention.
    if (attempt.kind === 'retry' || attempt.kind === 'practice') return;
    const key = `${attempt.countryId}:${attempt.skill}`;
    const previous = this.learningItems.get(key);
    const unassistedSuccess = attempt.correct && !attempt.assisted;
    const intervalDays = unassistedSuccess
      ? attempt.kind === 'review'
        ? reviewIntervals.find(interval => interval > (previous?.intervalDays ?? 0)) ?? 30
        : 1
      : 0;
    this.learningItems.set(key, {
      level: !unassistedSuccess ? 'Learning' : intervalDays > 1 ? 'Retained' : 'Familiar',
      intervalDays,
      dueAt: new Date(Date.parse(attempt.answeredAt) + (unassistedSuccess ? intervalDays * day : 10 * 60 * 1000)).toISOString(),
    });
  }

  private recordAttempt(attempt: Attempt, index: number) {
    this.updateProficiency(attempt);
    let history = this.selectionHistory.get(attempt.countryId);
    if (!history) {
      history = { lastSeenIndex: index, weak: false };
      this.selectionHistory.set(attempt.countryId, history);
    } else {
      history.lastSeenIndex = index;
    }
    // Retries delay this country's next revisit without erasing its weakness.
    if (attempt.kind === 'retry') return;
    history.weak = !attempt.correct || attempt.assisted;
    if (attempt.kind === 'new') this.introductionsSinceRevisit += 1;
    else this.introductionsSinceRevisit = 0;
  }

  answer(longitude: number, latitude: number) {
    const country = this.country;
    if (!this.started || this.readingFacts || !country || this.feedback || !Number.isFinite(longitude) || !Number.isFinite(latitude)
      || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return;
    const point = [longitude, latitude];
    const inside = booleanPointInPolygon(point, country);
    const selected = inside ? country : countries.find(candidate => booleanPointInPolygon(point, candidate));
    const correct = inside || (!selected && pointToPolygonDistance(point, country, { units: 'kilometers' }) <= 25);
    const attempt: Attempt = {
      countryId: country.properties.id,
      skill: 'name-to-location',
      kind: this.state.current!.kind,
      assisted: this.assisted,
      boundaryVersion: 'natural-earth-5.1.2-50m',
      factVersion,
      longitude, latitude, correct,
      selectedCountry: selected?.properties.name ?? null,
      answeredAt: new Date().toISOString(),
    };
    this.attempts.push(attempt);
    this.recordAttempt(attempt, this.attempts.length - 1);
    this.save();
  }

  retry() {
    if (!this.feedback || this.feedback.correct) return;
    this.state.current = { countryId: this.feedback.countryId, kind: 'retry', assisted: this.feedback.assisted };
    this.state.cursor = this.attempts.length;
    this.save();
  }

  private selectQuestion(now: string) {
    const selected = this.selectAdaptive(now);
    const index = this.state.pausedQuestions.findIndex(question => question.countryId === selected.countryId);
    return index < 0 ? selected : this.state.pausedQuestions.splice(index, 1)[0];
  }

  private selectAdaptive(now: string) {
    let dueCountryId: string | undefined;
    let earliestDueAt: string | undefined;
    let revisitCountryId: string | undefined;
    let revisitHistory: { lastSeenIndex: number; weak: boolean } | undefined;
    let oldestCountryId: string | undefined;
    let oldestSeenIndex = Infinity;
    for (const country of countries) {
      if (this.selection && !matchesFacets(country, this.selection)) continue;
      const countryId = country.properties.id;
      const item = this.learningItems.get(`${countryId}:name-to-location`);
      if (item && item.dueAt <= now && (!earliestDueAt || item.dueAt < earliestDueAt)) {
        dueCountryId = countryId;
        earliestDueAt = item.dueAt;
      }
      const history = this.selectionHistory.get(countryId);
      if (!history) continue;
      if (history.lastSeenIndex < oldestSeenIndex) {
        oldestCountryId = countryId;
        oldestSeenIndex = history.lastSeenIndex;
      }
      if (this.attempts.length - history.lastSeenIndex > 2
        && (!revisitHistory || (history.weak && !revisitHistory.weak)
          || (history.weak === revisitHistory.weak && history.lastSeenIndex < revisitHistory.lastSeenIndex))) {
        revisitCountryId = countryId;
        revisitHistory = history;
      }
    }
    if (dueCountryId) return { countryId: dueCountryId, kind: 'review' as const, assisted: false };
    const unseenCountryId = introductionOrder.find(country =>
      (!this.selection || matchesFacets(country, this.selection)) && !this.selectionHistory.has(country.properties.id))?.properties.id;
    if (revisitCountryId && (this.introductionsSinceRevisit >= 2 || !unseenCountryId)) {
      return { countryId: revisitCountryId, kind: 'practice' as const, assisted: false };
    }
    if (unseenCountryId) return { countryId: unseenCountryId, kind: 'new' as const, assisted: false };
    // With no unseen countries, at least one answered country must exist.
    return { countryId: oldestCountryId!, kind: 'practice' as const, assisted: false };
  }

  next() {
    if (this.started && this.readingFacts) {
      const places = introductionOrder.filter(country => matchesFacets(country, this.selection!));
      const index = places.findIndex(country => country.properties.id === this.state.readingCountryId);
      this.selectFactCountry(places[(index + 1) % places.length].properties.id);
      this.save();
      return;
    }
    if (!this.started || (this.state.current && !this.feedback)) return;
    this.state.cursor = this.attempts.length;
    this.state.current = this.selectQuestion(new Date().toISOString());
    this.save();
  }
}
