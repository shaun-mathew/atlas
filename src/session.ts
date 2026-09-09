import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import { countries, introductionOrder } from './geography';
import { factVersion } from './facts';
import { difficultyContexts, facetSelectionSchema, matchesFacets, type DifficultyContext, type FacetSelection } from './facets';
import { boundaryVersion, initialProgress, learningItemKey, progressSchema, type Attempt, type Progress, type Question } from './progress';

const countriesById = new Map(countries.map(country => [country.properties.id, country]));
type Proficiency = {
  level: 'Learning' | 'Familiar' | 'Retained';
  intervalDays: number;
  dueAt: string;
};
const reviewIntervals = [1, 3, 7, 14, 30];
const day = 24 * 60 * 60 * 1000;


// Attempts are the durable source of skill proficiency and scheduling state.
// Replaying them also upgrades older saves without discarding learner history.
export class LearnerSession {
  private state = initialProgress();
  private learningItems = new Map<string, Proficiency>();
  private selectionHistory = new Map<string, { lastSeenIndex: number; weak: boolean }>();
  private shapeContexts = new Map<string, { context: DifficultyContext; misses: number }>();
  private selectionCounts = {
    'name-to-location': { introductions: 0, attempts: 0 },
    'shape-recognition': { introductions: 0, attempts: 0 },
  };
  private readonly storageKey: string | null;
  onchange?: () => void;
  storageNotice = '';

  constructor(storageKey: string | null = 'atlas-practice.guest', initial?: Progress) {
    this.storageKey = storageKey;
    if (initial !== undefined) {
      this.replace(initial);
      return;
    }
    if (this.storageKey === null) return;
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved === null) return;
      this.state = progressSchema.parse(JSON.parse(saved));
      this.rebuild();
      this.save();
    } catch {
      this.storageNotice = 'Saved progress could not be read. Starting a session will replace any unreadable save. Browser storage must be available to retain new progress.';
    }
  }

  snapshot(): Progress {
    return structuredClone(this.state);
  }

  replace(progress: Progress): void {
    this.state = progressSchema.parse(progress);
    this.rebuild();
    this.save();
  }

  private supportsAttempt(attempt: Attempt): boolean {
    return countriesById.has(attempt.countryId) && (attempt.skill === 'name-to-location' || attempt.skill === 'shape-recognition')
      && attempt.boundaryVersion === boundaryVersion && attempt.factVersion === factVersion;
  }

  private rebuild() {
    this.learningItems.clear();
    this.selectionHistory.clear();
    this.shapeContexts.clear();
    for (const count of Object.values(this.selectionCounts)) { count.introductions = 0; count.attempts = 0; }
    for (const attempt of this.attempts) this.recordAttempt(attempt);
    const current = this.state.current;
    const answer = this.attempts[this.cursor];
    if (current && (!countriesById.has(current.countryId) || (answer && !this.supportsAttempt(answer)))) {
      if (!answer) this.state.pausedQuestions.push(current);
      this.state.current = null;
      this.state.cursor = this.attempts.length;
    }
    if (this.started && !this.state.current) this.state.current = this.selectQuestion(new Date().toISOString());
    if (this.readingFacts) this.selectFactCountry(this.state.readingCountryId!);
  }

  get started() { return this.state.started; }
  get cursor() { return this.state.cursor; }
  get attempts() { return this.state.attempts; }
  get readingFacts() { return this.selection?.learning === 'country-facts'; }
  get questionKind() { return this.readingFacts ? undefined : this.state.current?.kind; }
  get skill() { return this.state.current?.skill ?? 'name-to-location'; }
  get recognizingShape() { return !this.readingFacts && this.skill === 'shape-recognition'; }
  get difficultyContext() { return this.recognizingShape ? this.state.current?.difficultyContext : undefined; }
  get nextDifficultyContext() {
    return this.recognizingShape && this.state.current
      ? this.shapeContexts.get(learningItemKey(this.state.current))?.context ?? this.difficultyContext : undefined;
  }
  get assisted() { return !this.readingFacts && (this.state.current?.assisted ?? false); }
  get country() {
    const id = this.readingFacts ? this.state.readingCountryId : this.state.current?.countryId;
    return id ? countriesById.get(id) ?? null : null;
  }
  get feedback() { return this.readingFacts ? undefined : this.attempts[this.cursor]; }
  get proficiency() {
    return !this.readingFacts && this.state.current ? this.learningItems.get(learningItemKey(this.state.current)) : undefined;
  }
  get selection() { return this.state.selection; }

  choosePractice(selection: FacetSelection | null) {
    const nextSelection = selection === null ? null : facetSelectionSchema.parse(selection);
    if (this.started && nextSelection?.continent === this.selection?.continent
      && nextSelection?.region === this.selection?.region && nextSelection?.learning === this.selection?.learning
      && nextSelection?.startingContext === this.selection?.startingContext) return;
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
    // The reading map exposes both outline and location. Preserve that exposure
    // on every pending skill for the entity without recording an assessment.
    const pending = this.state.current && !this.attempts[this.cursor]
      ? [this.state.current, ...this.state.pausedQuestions] : this.state.pausedQuestions;
    let changed = false;
    for (const question of pending) {
      if (question.countryId !== countryId || question.assisted) continue;
      question.assisted = true;
      changed = true;
    }
    return changed;
  }

  reset(): boolean {
    const fresh = initialProgress();
    try {
      // Persist first: a failed write must leave the active session intact.
      if (this.storageKey !== null) localStorage.setItem(this.storageKey, JSON.stringify(fresh));
    } catch {
      this.storageNotice = 'Learning progress could not be reset because browser storage is unavailable or full. Your existing progress has been kept.';
      return false;
    }
    this.state = fresh;
    this.learningItems.clear();
    this.selectionHistory.clear();
    this.shapeContexts.clear();
    for (const count of Object.values(this.selectionCounts)) { count.introductions = 0; count.attempts = 0; }
    this.storageNotice = '';
    this.onchange?.();
    return true;
  }

  start() {
    this.state.started = true;
    if (!this.state.current) this.state.current = this.selectQuestion(new Date().toISOString());
    this.save();
  }


  requestLocationHelp() {
    if (!this.started || this.readingFacts || this.recognizingShape || !this.state.current || this.feedback || this.assisted) return;
    this.state.current.assisted = true;
    this.save();
  }

  private save() {
    try {
      if (this.storageKey !== null) localStorage.setItem(this.storageKey, JSON.stringify(this.state));
      this.storageNotice = '';
    } catch {
      this.storageNotice = 'Progress is not saved. Browser storage is unavailable or full. You can keep practicing, but new progress may be lost when you close this page.';
    }
    this.onchange?.();
  }

  private updateShapeContext(attempt: Attempt): boolean {
    if (attempt.skill !== 'shape-recognition' || !attempt.difficultyContext) return false;
    const key = learningItemKey(attempt);
    const previous = this.shapeContexts.get(key);
    let context = previous?.context ?? attempt.difficultyContext;
    let misses = attempt.correct ? 0 : (previous?.misses ?? 0) + 1;
    const repeatedMiss = misses >= 2;
    if (attempt.correct && !attempt.assisted && (attempt.kind === 'new' || attempt.kind === 'review')) {
      // A remembered answer on immediate retry is not evidence for fewer clues.
      context = difficultyContexts[Math.max(difficultyContexts.indexOf(context),
        Math.min(difficultyContexts.length - 1, difficultyContexts.indexOf(attempt.difficultyContext) + 1))];
    }
    if (repeatedMiss) {
      context = difficultyContexts[Math.max(0, Math.min(
        difficultyContexts.indexOf(context), difficultyContexts.indexOf(attempt.difficultyContext),
      ) - 1)];
      misses = 0;
    }
    this.shapeContexts.set(key, { context, misses });
    return repeatedMiss;
  }

  private updateProficiency(attempt: Attempt) {
    const repeatedShapeMiss = this.updateShapeContext(attempt);
    const key = learningItemKey(attempt);
    const previous = this.learningItems.get(key);
    // Practice never earns retention. Repeated shape misses can bring a check
    // forward, but a retry cannot postpone one that is already scheduled.
    if (attempt.kind === 'retry' || attempt.kind === 'practice') {
      if (repeatedShapeMiss) {
        const recheckAt = new Date(Date.parse(attempt.answeredAt) + 10 * 60 * 1000).toISOString();
        this.learningItems.set(key, {
          level: 'Learning', intervalDays: 0,
          dueAt: previous && previous.dueAt < recheckAt ? previous.dueAt : recheckAt,
        });
      }
      return;
    }
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

  private recordAttempt(attempt: Attempt) {
    if (!this.supportsAttempt(attempt)) return;
    const count = this.selectionCounts[attempt.skill as keyof typeof this.selectionCounts];
    const index = count.attempts++;
    this.updateProficiency(attempt);
    const key = learningItemKey(attempt);
    let history = this.selectionHistory.get(key);
    if (!history) {
      history = { lastSeenIndex: index, weak: false };
      this.selectionHistory.set(key, history);
    } else {
      history.lastSeenIndex = index;
    }
    // Retries delay this country's next revisit without erasing its weakness.
    if (attempt.kind === 'retry') return;
    history.weak = !attempt.correct || attempt.assisted;
    if (attempt.kind === 'new') count.introductions += 1;
    else count.introductions = 0;
  }

  answer(longitude: number, latitude: number) {
    const country = this.country;
    if (!this.started || this.readingFacts || this.recognizingShape || !country || this.feedback || !Number.isFinite(longitude) || !Number.isFinite(latitude)
      || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return;
    const point = [longitude, latitude];
    const inside = booleanPointInPolygon(point, country);
    const selected = inside ? country : countries.find(candidate => booleanPointInPolygon(point, candidate));
    const correct = inside || (!selected && pointToPolygonDistance(point, country, { units: 'kilometers' }) <= 25);
    const attempt: Attempt = {
      // The ordinal preserves local causal order when answers share a timestamp;
      // the UUID keeps different devices' answers distinct at the same ordinal.
      id: `attempt-${this.attempts.length.toString(36).padStart(10, '0')}-${crypto.randomUUID()}`,
      countryId: country.properties.id,
      skill: 'name-to-location',
      kind: this.state.current!.kind,
      assisted: this.assisted,
      boundaryVersion,
      factVersion,
      longitude, latitude, correct,
      selectedCountry: selected?.properties.name ?? null,
      answeredAt: new Date().toISOString(),
    };
    this.commitAttempt(attempt);
  }

  answerCountry(countryId: string) {
    const country = this.country;
    const selected = countriesById.get(countryId);
    if (!this.started || !this.recognizingShape || !country || this.feedback || !selected) return;
    this.commitAttempt({
      id: `attempt-${this.attempts.length.toString(36).padStart(10, '0')}-${crypto.randomUUID()}`,
      countryId: country.properties.id,
      skill: 'shape-recognition',
      difficultyContext: this.difficultyContext,
      kind: this.state.current!.kind,
      assisted: this.assisted,
      boundaryVersion, factVersion,
      correct: countryId === country.properties.id,
      selectedCountryId: countryId,
      selectedCountry: selected.properties.name,
      answeredAt: new Date().toISOString(),
    });
  }

  private commitAttempt(attempt: Attempt) {
    this.attempts.push(attempt);
    const previous = this.attempts[this.attempts.length - 2];
    if (previous && (previous.answeredAt > attempt.answeredAt
      || (previous.answeredAt === attempt.answeredAt && previous.id > attempt.id))) {
      // A clock change or another device's future timestamp can insert an answer
      // before existing history. Normalize by ID, then replay in that order.
      this.state = progressSchema.parse(this.state);
      this.rebuild();
    } else {
      this.recordAttempt(attempt);
    }
    this.save();
  }

  retry() {
    if (!this.feedback || this.feedback.correct) return;
    this.state.current = {
      ...this.state.current,
      countryId: this.feedback.countryId, kind: 'retry',
      assisted: this.feedback.assisted || (this.state.current?.assisted ?? false),
      ...(this.recognizingShape ? { difficultyContext: this.nextDifficultyContext } : {}),
    };
    this.state.cursor = this.attempts.length;
    this.save();
  }

  private selectQuestion(now: string) {
    const selected = this.selectAdaptive(now);
    const index = this.state.pausedQuestions.findIndex(question => learningItemKey(question) === learningItemKey(selected));
    return index < 0 ? selected : this.state.pausedQuestions.splice(index, 1)[0];
  }

  private selectAdaptive(now: string): Question {
    const skill = this.selection?.learning === 'shape-recognition' ? 'shape-recognition' : 'name-to-location';
    const count = this.selectionCounts[skill];
    const question = (countryId: string, kind: Question['kind']): Question => ({
      countryId, kind, assisted: false,
      ...(skill === 'shape-recognition' ? {
        skill, difficultyContext: this.shapeContexts.get(`${countryId}:${skill}`)?.context ?? this.selection?.startingContext ?? 'rich',
      } : {}),
    });
    let dueCountryId: string | undefined;
    let earliestDueAt: string | undefined;
    let revisitCountryId: string | undefined;
    let revisitHistory: { lastSeenIndex: number; weak: boolean } | undefined;
    let oldestCountryId: string | undefined;
    let oldestSeenIndex = Infinity;
    for (const country of countries) {
      if (this.selection && !matchesFacets(country, this.selection)) continue;
      const countryId = country.properties.id;
      const item = this.learningItems.get(`${countryId}:${skill}`);
      if (item && item.dueAt <= now && (!earliestDueAt || item.dueAt < earliestDueAt)) {
        dueCountryId = countryId;
        earliestDueAt = item.dueAt;
      }
      const history = this.selectionHistory.get(`${countryId}:${skill}`);
      if (!history) continue;
      if (history.lastSeenIndex < oldestSeenIndex) {
        oldestCountryId = countryId;
        oldestSeenIndex = history.lastSeenIndex;
      }
      if (count.attempts - history.lastSeenIndex > 2
        && (!revisitHistory || (history.weak && !revisitHistory.weak)
          || (history.weak === revisitHistory.weak && history.lastSeenIndex < revisitHistory.lastSeenIndex))) {
        revisitCountryId = countryId;
        revisitHistory = history;
      }
    }
    if (dueCountryId) return question(dueCountryId, 'review');
    const unseenCountryId = introductionOrder.find(country =>
      (!this.selection || matchesFacets(country, this.selection)) && !this.selectionHistory.has(`${country.properties.id}:${skill}`))?.properties.id;
    if (revisitCountryId && (count.introductions >= 2 || !unseenCountryId)) {
      return question(revisitCountryId, 'practice');
    }
    if (unseenCountryId) return question(unseenCountryId, 'new');
    // With no unseen countries, at least one answered country must exist.
    return question(oldestCountryId!, 'practice');
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
