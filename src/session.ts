import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import { z } from 'zod';
import { countries, introductionOrder } from './geography';
import { factVersion } from './facts';

const countriesById = new Map(countries.map(country => [country.properties.id, country]));
const countryIdSchema = z.string().refine(id => countriesById.has(id));
const attemptSchema = z.object({
  countryId: countryIdSchema,
  skill: z.literal('name-to-location'),
  boundaryVersion: z.literal('natural-earth-5.1.2-50m'),
  // Answers saved before fact cards use the first published fact release.
  factVersion: z.literal(factVersion).default('2026-09-07'),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-85).max(85),
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
const questionKindSchema = z.enum(['new', 'review', 'practice', 'retry', 'diagnostic']);
const questionSchema = z.object({
  countryId: countryIdSchema,
  kind: questionKindSchema,
  assisted: z.boolean().default(false),
});
const progressV2Schema = z.object({
  version: z.literal(2),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  current: questionSchema.nullable(),
  attempts: z.array(attemptSchema.extend({ kind: questionKindSchema })),
}).refine(state => {
  const answer = state.attempts[state.cursor];
  return (state.attempts.length === state.cursor || state.attempts.length === state.cursor + 1)
    && (state.started || (state.cursor === 0 && state.attempts.length === 0))
    && (!answer || (answer.countryId === state.current?.countryId && answer.kind === state.current.kind));
});
const diagnosticSchema = z.object({
  countries: z.array(countryIdSchema).min(1),
  index: z.number().int().nonnegative(),
});
const progressSchema = z.object({
  version: z.literal(4),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  current: questionSchema.nullable(),
  attempts: z.array(attemptSchema.extend({ kind: questionKindSchema })),
  mode: z.enum(['adaptive', 'diagnostic']),
  diagnostic: diagnosticSchema.nullable(),
}).refine(state => {
  const answer = state.attempts[state.cursor];
  return (state.attempts.length === state.cursor || state.attempts.length === state.cursor + 1)
    && (state.started || (state.cursor === 0 && state.attempts.length === 0))
    && (!answer || (answer.countryId === state.current?.countryId && answer.kind === state.current.kind))
    && (state.mode === 'diagnostic' ? state.diagnostic !== null : state.diagnostic === null)
    && (!state.current || state.current.kind !== 'diagnostic' || state.mode === 'diagnostic');
});

type Attempt = z.infer<typeof progressSchema>['attempts'][number];
type Proficiency = {
  level: 'Learning' | 'Familiar' | 'Retained';
  intervalDays: number;
  dueAt: string;
};
const reviewIntervals = [1, 3, 7, 14, 30];
const day = 24 * 60 * 60 * 1000;
const diagnosticItemCount = 8;

function initialState(): z.infer<typeof progressSchema> {
  return {
    version: 4, started: false, cursor: 0, attempts: [],
    current: { countryId: introductionOrder[0].properties.id, kind: 'new', assisted: false },
    mode: 'adaptive', diagnostic: null,
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
          ...legacy, version: 4,
          current: {
            countryId: countries[legacy.cursor % countries.length].properties.id,
            kind: 'new',
            assisted: legacy.attempts[legacy.cursor]?.assisted ?? false,
          },
          attempts: legacy.attempts.map(attempt => ({ ...attempt, kind: 'new' as const })),
          mode: 'adaptive',
          diagnostic: null,
        };
      } else if (parsed.version === 2) {
        const legacy = progressV2Schema.parse(parsed);
        this.state = {
          ...legacy,
          version: 4,
          mode: 'adaptive',
          diagnostic: null,
        };
      } else {
        // Version 3's obsolete session cap is discarded by the current schema.
        this.state = progressSchema.parse(parsed.version === 3 ? { ...parsed, version: 4 } : parsed);
      }
      if (!this.started) this.state = initialState();
      this.attempts.forEach((attempt, index) => this.recordAttempt(attempt, index));
      const waiting = this.started && this.state.mode === 'adaptive' && !this.state.current;
      if (waiting) this.state.current = this.selectAdaptive(new Date().toISOString());
      if (waiting || parsed.version !== 4) this.save();
    } catch {
      this.storageNotice = 'Saved guest progress could not be read. Starting a session will replace any unreadable save. Browser storage must be available to retain new progress.';
    }
  }

  get started() { return this.state.started; }
  get cursor() { return this.state.cursor; }
  get attempts() { return this.state.attempts; }
  get mode() { return this.state.mode; }
  get diagnosticComplete() {
    return this.state.mode === 'diagnostic'
      && !!this.state.diagnostic
      && this.state.diagnostic.index >= this.state.diagnostic.countries.length
      && !this.country;
  }
  get diagnosticNumber() {
    return this.state.current?.kind === 'diagnostic' && this.state.diagnostic
      ? this.state.diagnostic.index + 1
      : undefined;
  }
  get diagnosticTotal() { return this.state.diagnostic?.countries.length; }
  get questionKind() { return this.state.current?.kind; }
  get assisted() { return this.state.current?.assisted ?? false; }
  get country() { return this.state.current ? countriesById.get(this.state.current.countryId)! : null; }
  get feedback() { return this.attempts[this.cursor]; }
  get proficiency() { return this.state.current ? this.learningItems.get(`${this.state.current.countryId}:name-to-location`) : undefined; }

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
    this.state.mode = 'adaptive';
    this.state.diagnostic = null;
    if (!this.state.current) this.state.current = this.selectAdaptive(new Date().toISOString());
    this.save();
  }

  startDiagnostic() {
    const diagnosticCountries = introductionOrder.slice(0, diagnosticItemCount).map(country => country.properties.id);
    this.state.started = true;
    this.state.mode = 'diagnostic';
    this.state.cursor = this.attempts.length;
    this.state.diagnostic = { countries: diagnosticCountries, index: 0 };
    this.state.current = { countryId: diagnosticCountries[0], kind: 'diagnostic', assisted: false };
    this.save();
  }

  startAdaptive() {
    this.state.started = true;
    this.state.mode = 'adaptive';
    this.state.diagnostic = null;
    this.state.cursor = this.attempts.length;
    this.state.current = this.selectAdaptive(new Date().toISOString());
    this.save();
  }

  requestLocationHelp() {
    if (!this.started || !this.state.current || this.feedback || this.assisted || this.state.mode === 'diagnostic') return;
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
    if (!this.started || !country || this.feedback || !Number.isFinite(longitude) || !Number.isFinite(latitude)
      || Math.abs(longitude) > 180 || Math.abs(latitude) > 85) return;
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
    if (this.state.mode === 'diagnostic' || !this.feedback || this.feedback.correct) return;
    this.state.current = { countryId: this.feedback.countryId, kind: 'retry', assisted: this.feedback.assisted };
    this.state.cursor = this.attempts.length;
    this.save();
  }

  private selectAdaptive(now: string) {
    let dueCountryId: string | undefined;
    let earliestDueAt: string | undefined;
    let revisitCountryId: string | undefined;
    let revisitHistory: { lastSeenIndex: number; weak: boolean } | undefined;
    let oldestCountryId: string | undefined;
    let oldestSeenIndex = Infinity;
    for (const country of countries) {
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
    const unseenCountryId = introductionOrder.find(country => !this.selectionHistory.has(country.properties.id))?.properties.id;
    if (revisitCountryId && (this.introductionsSinceRevisit >= 2 || !unseenCountryId)) {
      return { countryId: revisitCountryId, kind: 'practice' as const, assisted: false };
    }
    if (unseenCountryId) return { countryId: unseenCountryId, kind: 'new' as const, assisted: false };
    // With no unseen countries, at least one answered country must exist.
    return { countryId: oldestCountryId!, kind: 'practice' as const, assisted: false };
  }

  next() {
    if (!this.started || (this.state.current && !this.feedback)) return;
    this.state.cursor = this.attempts.length;
    if (this.state.mode === 'diagnostic') {
      const diagnostic = this.state.diagnostic!;
      diagnostic.index += 1;
      this.state.current = diagnostic.index < diagnostic.countries.length
        ? { countryId: diagnostic.countries[diagnostic.index], kind: 'diagnostic', assisted: false }
        : null;
      this.save();
      return;
    }
    this.state.current = this.selectAdaptive(new Date().toISOString());
    this.save();
  }
}
