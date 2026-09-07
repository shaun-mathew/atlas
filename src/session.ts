import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import { z } from 'zod';
import { countries } from './geography';
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
const questionSchema = z.object({
  countryId: countryIdSchema,
  kind: z.enum(['new', 'review', 'retry']),
  assisted: z.boolean().default(false),
});
const progressSchema = z.object({
  version: z.literal(2),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  current: questionSchema.nullable(),
  attempts: z.array(attemptSchema.extend({ kind: questionSchema.shape.kind })),
}).refine(state => {
  const answer = state.attempts[state.cursor];
  return (state.attempts.length === state.cursor || state.attempts.length === state.cursor + 1)
    && (state.started || (state.cursor === 0 && state.attempts.length === 0))
    && (!answer || (answer.countryId === state.current?.countryId && answer.kind === state.current.kind));
});

type Attempt = z.infer<typeof progressSchema>['attempts'][number];
type Proficiency = {
  level: 'Learning' | 'Familiar' | 'Retained';
  intervalDays: number;
  dueAt: string;
};
const reviewIntervals = [1, 3, 7, 14, 30];
const day = 24 * 60 * 60 * 1000;

// Attempts are the durable source of skill proficiency and scheduling state.
// Replaying them also upgrades older saves without discarding learner history.
export class GuestSession {
  private state: z.infer<typeof progressSchema> = {
    version: 2, started: false, cursor: 0, attempts: [],
    current: { countryId: countries[0].properties.id, kind: 'new', assisted: false },
  };
  private learningItems = new Map<string, Proficiency>();
  storageNotice = '';

  constructor() {
    try {
      const saved = localStorage.getItem('atlas-practice.guest');
      if (saved === null) return;
      const parsed = JSON.parse(saved);
      if (parsed.version === 1) {
        const legacy = legacyProgressSchema.parse(parsed);
        this.state = {
          ...legacy, version: 2,
          current: {
            countryId: countries[legacy.cursor % countries.length].properties.id,
            kind: 'new',
            assisted: legacy.attempts[legacy.cursor]?.assisted ?? false,
          },
          attempts: legacy.attempts.map(attempt => ({ ...attempt, kind: 'new' as const })),
        };
      } else {
        this.state = progressSchema.parse(parsed);
      }
      for (const attempt of this.attempts) this.updateProficiency(attempt);
    } catch {
      this.storageNotice = 'Saved guest progress could not be read. Starting a session will replace any unreadable save. Browser storage must be available to retain new progress.';
    }
  }

  get started() { return this.state.started; }
  get cursor() { return this.state.cursor; }
  get attempts() { return this.state.attempts; }
  get questionKind() { return this.state.current?.kind; }
  get assisted() { return this.state.current?.assisted ?? false; }
  get country() { return this.state.current ? countriesById.get(this.state.current.countryId)! : null; }
  get feedback() { return this.attempts[this.cursor]; }
  get proficiency() { return this.state.current ? this.learningItems.get(`${this.state.current.countryId}:name-to-location`) : undefined; }
  get nextReviewAt() {
    let earliest: string | undefined;
    for (const item of this.learningItems.values()) {
      if (!earliest || item.dueAt < earliest) earliest = item.dueAt;
    }
    return earliest;
  }

  start() {
    this.state.started = true;
    this.save();
  }

  requestLocationHelp() {
    if (!this.started || !this.state.current || this.feedback || this.assisted) return;
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
    // Repeating a revealed answer records practice, not evidence of retention.
    if (attempt.kind === 'retry') return;
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
    this.updateProficiency(attempt);
    this.save();
  }

  retry() {
    if (!this.feedback || this.feedback.correct) return;
    this.state.current = { countryId: this.feedback.countryId, kind: 'retry', assisted: this.feedback.assisted };
    this.state.cursor = this.attempts.length;
    this.save();
  }

  next() {
    if (!this.started || (this.state.current && !this.feedback)) return;
    const now = new Date().toISOString();
    let due: { countryId: string; dueAt: string } | undefined;
    let unseen: string | undefined;
    for (const country of countries) {
      const countryId = country.properties.id;
      const item = this.learningItems.get(`${countryId}:name-to-location`);
      if (!item) unseen ??= countryId;
      else if (item.dueAt <= now && (!due || item.dueAt < due.dueAt)) due = { countryId, dueAt: item.dueAt };
    }
    this.state.cursor = this.attempts.length;
    this.state.current = due ? { countryId: due.countryId, kind: 'review', assisted: false }
      : unseen ? { countryId: unseen, kind: 'new', assisted: false } : null;
    this.save();
  }
}
