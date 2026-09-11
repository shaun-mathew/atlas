import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import { countries, introductionOrder, matchesCountrySearch, normalizeCountrySearch } from './geography';
import { factVersion } from './facts';
import { facetSelectionSchema, matchesCityFacets, matchesFacets, practiceCandidateCount, type FacetSelection } from './facets';
import { boundaryVersion, initialProgress, learningItemKey, progressSchema, type Attempt, type Progress, type SpatialSkill } from './progress';
import { scheduleReview, type Proficiency } from './scheduler';
import { cities, citiesById, cityContentVersion, cityDistanceKm, cityToleranceKm, type City } from './cities';
import { cityIntroductionOrder, capitalIntroductionOrder } from './city-introductions';

const countriesById = new Map(countries.map(country => [country.properties.id, country]));
const recommendedSkills: readonly SpatialSkill[] = ['name-to-location', 'location-to-name-recognition', 'shape-recognition'];
const recognitionFamiliarCountryCount = 40;
type Question = NonNullable<Progress['current']>;
type LearningEntity = Pick<Question, 'countryId' | 'cityId'>;
const countryItems: LearningEntity[] = countries.map(country => ({ countryId: country.properties.id }));
const countryIntroductions: LearningEntity[] = introductionOrder.map(country => ({ countryId: country.properties.id }));
const cityItems: LearningEntity[] = cities.map(city => ({ countryId: city.countryId, cityId: city.id }));
const cityIntroductions: LearningEntity[] = cityIntroductionOrder.map(city => ({ countryId: city.countryId, cityId: city.id }));
const capitalIntroductions: LearningEntity[] = capitalIntroductionOrder.map(city => ({ countryId: city.countryId, cityId: city.id }));


// Attempts are the durable source of skill proficiency and scheduling state.
// Replaying them also upgrades older saves without discarding learner history.
export class LearnerSession {
  private state = initialProgress();
  private learningItems = new Map<string, Proficiency>();
  private selectionHistory = new Map<string, { lastSeenIndex: number; weak: boolean }>();
  private selectionCounts = new Map<string, { attempts: number; introductions: number }>();
  private shapeMissCounts = new Map<string, number>();
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
    if (attempt.cityId !== undefined) {
      const city = citiesById.get(attempt.cityId);
      return !!city && city.countryId === attempt.countryId
        && (attempt.skill === 'name-to-location' || (attempt.skill === 'capital-to-location' && city.capital))
        && attempt.factVersion === cityContentVersion && attempt.toleranceKm === cityToleranceKm;
    }
    return countriesById.has(attempt.countryId)
      && (attempt.skill === 'name-to-location' || attempt.skill === 'location-to-name-recognition' || attempt.skill === 'shape-recognition')
      && attempt.boundaryVersion === boundaryVersion && attempt.factVersion === factVersion;
  }

  private rebuild() {
    this.learningItems.clear();
    this.selectionHistory.clear();
    this.selectionCounts.clear();
    this.shapeMissCounts.clear();
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
  get recognizingLocation() { return !this.readingFacts && this.state.current?.skill === 'location-to-name-recognition'; }
  get skill() { return this.state.current?.skill ?? 'name-to-location'; }
  private get practiceSkill(): SpatialSkill {
    const learning = this.selection?.learning;
    return learning === 'location-to-name-recognition' || learning === 'shape-recognition' || learning === 'capital-to-location'
      ? learning : 'name-to-location';
  }
  get questionKind() { return this.readingFacts ? undefined : this.state.current?.kind; }
  get recognizingShape() { return !this.readingFacts && this.skill === 'shape-recognition'; }
  get assisted() { return !this.readingFacts && (this.state.current?.assisted ?? false); }
  get country() {
    const id = this.readingFacts ? this.state.readingCountryId : this.state.current?.countryId;
    return id ? countriesById.get(id) ?? null : null;
  }
  get city(): City | null {
    const id = this.readingFacts ? undefined : this.state.current?.cityId;
    return id ? citiesById.get(id) ?? null : null;
  }
  get feedback() { return this.readingFacts ? undefined : this.attempts[this.cursor]; }
  get proficiency() {
    return !this.readingFacts && this.state.current ? this.learningItems.get(learningItemKey(this.state.current)) : undefined;
  }
  get selection() { return this.state.selection; }

  searchCountries(query: string) {
    if (!this.recognizingLocation && !this.recognizingShape) return [];
    const text = normalizeCountrySearch(query);
    return countries.filter(country => (!this.selection || matchesFacets(country, this.selection))
      && matchesCountrySearch(country, text));
  }

  choosePractice(selection: FacetSelection | null): boolean {
    const nextSelection = selection === null ? null : facetSelectionSchema.parse(selection);
    if (practiceCandidateCount(nextSelection) === 0) return false;
    if (this.started && nextSelection?.scope === this.selection?.scope
      && nextSelection?.continent === this.selection?.continent
      && nextSelection?.region === this.selection?.region && nextSelection?.learning === this.selection?.learning) return true;
    this.state.selection = nextSelection;
    if (this.readingFacts) {
      this.selectFactCountry(introductionOrder.find(country => matchesFacets(country, this.selection!))!.properties.id);
    } else {
      // Keep unanswered prompts (including revealed location help) until that
      // entity is selected again. Switching scope must not turn help into recall.
      if (this.started && this.state.current && !this.attempts[this.cursor]) this.state.pausedQuestions.push(this.state.current);
      this.state.readingCountryId = null;
      this.state.cursor = this.attempts.length;
      this.state.current = this.selectQuestion(new Date().toISOString());
    }
    this.start();
    return true;
  }

  private selectFactCountry(countryId: string): boolean {
    this.state.readingCountryId = countryId;
    // The reading map exposes both outline and location. Preserve that exposure
    // on every pending skill for the entity without recording an assessment.
    const pending = this.state.current && !this.attempts[this.cursor]
      ? [this.state.current, ...this.state.pausedQuestions] : this.state.pausedQuestions;
    let changed = false;
    for (const question of pending) {
      if (question.cityId !== undefined || question.countryId !== countryId || question.assisted) continue;
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
    this.selectionCounts.clear();
    this.shapeMissCounts.clear();
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
    if (!this.started || this.readingFacts || this.recognizingLocation || this.recognizingShape || !this.state.current || this.feedback || this.assisted) return;
    this.state.current.assisted = true;
    if (this.state.current.cityId !== undefined) {
      for (const question of this.state.pausedQuestions) {
        if (question.cityId === this.state.current.cityId) question.assisted = true;
      }
    }
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

  private recordShapeMiss(attempt: Attempt): boolean {
    if (attempt.skill !== 'shape-recognition') return false;
    const key = learningItemKey(attempt);
    const misses = attempt.correct ? 0 : (this.shapeMissCounts.get(key) ?? 0) + 1;
    const repeatedMiss = misses >= 2;
    this.shapeMissCounts.set(key, repeatedMiss ? 0 : misses);
    return repeatedMiss;
  }

  private updateProficiency(attempt: Attempt) {
    const repeatedShapeMiss = this.recordShapeMiss(attempt);
    const key = learningItemKey(attempt);
    const previous = this.learningItems.get(key);
    // Practice never earns retention. Repeated shape misses can bring a check
    // forward, but a retry cannot postpone one that is already scheduled.
    if (attempt.kind === 'retry' || attempt.kind === 'practice') {
      if (repeatedShapeMiss) {
        const recheckAt = new Date(Date.parse(attempt.answeredAt) + 10 * 60 * 1000).toISOString();
        const item = previous ?? scheduleReview(undefined, attempt);
        this.learningItems.set(key, {
          ...item, level: 'Learning',
          dueAt: item.dueAt < recheckAt ? item.dueAt : recheckAt,
        });
      }
      return;
    }
    this.learningItems.set(key, scheduleReview(previous, attempt));
  }

  private recordAttempt(attempt: Attempt) {
    if (!this.supportsAttempt(attempt)) return;
    const group = attempt.cityId === undefined ? attempt.skill : `city:${attempt.skill}`;
    let counts = this.selectionCounts.get(group);
    if (!counts) this.selectionCounts.set(group, counts = { attempts: 0, introductions: 0 });
    const index = counts.attempts++;
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
    if (attempt.kind === 'new') counts.introductions += 1;
    else counts.introductions = 0;
  }

  answer(longitude: number, latitude: number) {
    const country = this.country;
    if (!this.started || this.readingFacts || this.recognizingLocation || this.recognizingShape || !country || this.feedback || !Number.isFinite(longitude) || !Number.isFinite(latitude)
      || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return;
    const city = this.city;
    if (city) {
      const distanceKm = cityDistanceKm(longitude, latitude, city);
      this.commitAnswer({
        id: `attempt-${this.attempts.length.toString(36).padStart(10, '0')}-${crypto.randomUUID()}`,
        countryId: city.countryId, cityId: city.id, skill: this.skill,
        kind: this.state.current!.kind, assisted: this.assisted,
        boundaryVersion, factVersion: cityContentVersion,
        longitude, latitude, distanceKm, toleranceKm: cityToleranceKm,
        correct: distanceKm <= cityToleranceKm,
        selectedCountry: null, answeredAt: new Date().toISOString(),
      });
      return;
    }
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
    this.commitAnswer(attempt);
  }

  answerCountry(countryId: string) {
    const target = this.country;
    const selected = countriesById.get(countryId);
    if (!this.started || (!this.recognizingLocation && !this.recognizingShape) || !target || this.feedback || !selected
      || (this.selection && !matchesFacets(selected, this.selection))) return;
    this.commitAnswer({
      id: `attempt-${this.attempts.length.toString(36).padStart(10, '0')}-${crypto.randomUUID()}`,
      countryId: target.properties.id,
      skill: this.skill,
      kind: this.state.current!.kind,
      assisted: this.assisted,
      boundaryVersion, factVersion,
      correct: selected.properties.id === target.properties.id,
      selectedCountryId: selected.properties.id,
      selectedCountry: selected.properties.name,
      answeredAt: new Date().toISOString(),
    });
  }

  private commitAnswer(attempt: Attempt) {
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
      countryId: this.feedback.countryId, skill: this.skill, kind: 'retry',
      ...(this.feedback.cityId === undefined ? {} : { cityId: this.feedback.cityId }),
      assisted: this.feedback.assisted || (this.state.current?.assisted ?? false),
    };
    this.state.cursor = this.attempts.length;
    this.save();
  }

  private selectQuestion(now: string) {
    const selected = this.selection
      ? this.selectAdaptive(now, this.practiceSkill)!
      : this.selectRecommended(now);
    const index = this.state.pausedQuestions.findIndex(question => learningItemKey(question) === learningItemKey(selected));
    const question = index < 0 ? selected : this.state.pausedQuestions.splice(index, 1)[0];
    // A city location revealed for either skill is still known when switching
    // between its name and capital relationship, but reveals no country answer.
    if (question.cityId !== undefined) {
      question.assisted ||= (this.state.current?.cityId === question.cityId && this.state.current.assisted)
        || this.state.pausedQuestions.some(pending => pending.cityId === question.cityId && pending.assisted);
    }
    return question;
  }

  private selectRecommended(now: string): Question {
    // Answers reveal the name, outline and location. Separate sibling skills by
    // two other answers, or ten minutes, rather than testing immediate exposure.
    const recentCountries = new Set<string>();
    let recentAnswers = 0;
    for (let index = this.attempts.length - 1; index >= 0 && recentAnswers < 2; index--) {
      const attempt = this.attempts[index];
      if (!this.supportsAttempt(attempt)) continue;
      if (Date.parse(now) - Date.parse(attempt.answeredAt) >= 10 * 60 * 1000) break;
      recentCountries.add(attempt.countryId);
      recentAnswers++;
    }
    let familiarCountries = 0;
    for (const entity of countryItems) {
      const level = this.learningItems.get(learningItemKey({ ...entity, skill: 'name-to-location' }))?.level;
      if (level === 'Familiar' || level === 'Retained') familiarCountries++;
      if (familiarCountries >= recognitionFamiliarCountryCount) break;
    }
    // Rotate from the latest supported country answer, including after reload.
    // Lifetime counts make newly unlocked skills monopolize practice while
    // catching up with recall. Reviews take priority within each skill's turn.
    let previousSkillIndex = -1;
    for (let index = this.attempts.length - 1; index >= 0; index--) {
      const attempt = this.attempts[index];
      if (attempt.cityId !== undefined || !this.supportsAttempt(attempt)) continue;
      previousSkillIndex = recommendedSkills.findIndex(skill => skill === attempt.skill);
      break;
    }
    for (let offset = 1; offset <= recommendedSkills.length; offset++) {
      const skill = recommendedSkills[(previousSkillIndex + offset) % recommendedSkills.length];
      const candidate = this.selectAdaptive(now, skill, recentCountries,
        skill === 'name-to-location' || familiarCountries >= recognitionFamiliarCountryCount);
      if (candidate) return candidate;
    }
    // Recall always has a country outside the two-answer exclusion.
    return this.selectAdaptive(now, 'name-to-location', recentCountries)!;
  }

  private selectAdaptive(now: string, skill: SpatialSkill, recentCountries?: ReadonlySet<string>, allowIntroductions = true): Question | undefined {
    const cityPractice = this.selection !== null && this.selection.scope !== 'countries';
    const counts = this.selectionCounts.get(cityPractice ? `city:${skill}` : skill);
    const eligible = (entity: LearningEntity) => !this.selection || (entity.cityId === undefined
      ? matchesFacets(countriesById.get(entity.countryId)!, this.selection)
      : matchesCityFacets(citiesById.get(entity.cityId)!, this.selection));
    const candidates = (cityPractice ? cityItems : countryItems).filter(eligible);
    let due: LearningEntity | undefined;
    let earliestDueAt: string | undefined;
    let revisit: LearningEntity | undefined;
    let revisitHistory: { lastSeenIndex: number; weak: boolean } | undefined;
    let oldest: LearningEntity | undefined;
    let oldestSeenIndex = Infinity;
    for (const entity of candidates) {
      if (recentCountries?.has(entity.countryId)) continue;
      const key = learningItemKey({ ...entity, skill });
      const item = this.learningItems.get(key);
      if (item && item.dueAt <= now && (!earliestDueAt || item.dueAt < earliestDueAt)) {
        due = entity;
        earliestDueAt = item.dueAt;
      }
      const history = this.selectionHistory.get(key);
      if (!history) continue;
      if (history.lastSeenIndex < oldestSeenIndex) {
        oldest = entity;
        oldestSeenIndex = history.lastSeenIndex;
      }
      if ((counts?.attempts ?? 0) - history.lastSeenIndex > 2
        && (!revisitHistory || (history.weak && !revisitHistory.weak)
          || (history.weak === revisitHistory.weak && history.lastSeenIndex < revisitHistory.lastSeenIndex))) {
        revisit = entity;
        revisitHistory = history;
      }
    }
    if (due) return { ...due, skill, kind: 'review' as const, assisted: false };
    const introductions = cityPractice
      ? skill === 'capital-to-location' ? capitalIntroductions : cityIntroductions
      : countryIntroductions;
    const unseen = allowIntroductions ? introductions.find(entity => eligible(entity)
      && !recentCountries?.has(entity.countryId)
      && (this.selection || skill === 'name-to-location'
        || (this.learningItems.get(learningItemKey({ ...entity, skill: 'name-to-location' }))?.level ?? 'Learning') !== 'Learning')
      && !this.selectionHistory.has(learningItemKey({ ...entity, skill }))) : undefined;
    if (revisit && ((counts?.introductions ?? 0) >= 2 || !unseen)) {
      return { ...revisit, skill, kind: 'practice' as const, assisted: false };
    }
    if (unseen) return { ...unseen, skill, kind: 'new' as const, assisted: false };
    return oldest ? { ...oldest, skill, kind: 'practice', assisted: false } : undefined;
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
