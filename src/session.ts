import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { pointToPolygonDistance } from '@turf/point-to-polygon-distance';
import { z } from 'zod';
import { countries } from './geography';
import { factVersion } from './facts';

const progressSchema = z.object({
  version: z.literal(1),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  attempts: z.array(z.object({
    countryId: z.string(),
    skill: z.literal('name-to-location'),
    boundaryVersion: z.literal('natural-earth-5.1.2-50m'),
    // Answers saved before fact cards use the first published fact release.
    factVersion: z.literal(factVersion).default('2026-09-07'),
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-85).max(85),
    correct: z.boolean(),
    selectedCountry: z.string().nullable(),
    answeredAt: z.iso.datetime(),
  })),
}).refine(state =>
  (state.attempts.length === state.cursor || state.attempts.length === state.cursor + 1)
  && (state.started || (state.cursor === 0 && state.attempts.length === 0))
  && state.attempts.every((attempt, index) => attempt.countryId === countries[index % countries.length].properties.id),
);

// The cursor identifies the current learning item; an attempt at that cursor
// means feedback is pending. Advancing never re-records an answer.
export class GuestSession {
  private state: z.infer<typeof progressSchema> = { version: 1, started: false, cursor: 0, attempts: [] };
  storageNotice = '';

  constructor() {
    try {
      const saved = localStorage.getItem('atlas-practice.guest');
      if (saved !== null) this.state = progressSchema.parse(JSON.parse(saved));
    } catch {
      this.storageNotice = 'Saved guest progress could not be read. Starting a session will replace any unreadable save. Browser storage must be available to retain new progress.';
    }
  }

  get started() { return this.state.started; }
  get cursor() { return this.state.cursor; }
  get attempts() { return this.state.attempts; }

  start() {
    this.state.started = true;
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

  get country() { return countries[this.cursor % countries.length]; }
  get feedback() { return this.attempts[this.cursor]; }

  answer(longitude: number, latitude: number) {
    if (!this.started || this.feedback || !Number.isFinite(longitude) || !Number.isFinite(latitude)
      || Math.abs(longitude) > 180 || Math.abs(latitude) > 85) return;
    const point = [longitude, latitude];
    const inside = booleanPointInPolygon(point, this.country);
    const selected = inside ? this.country : countries.find(country => booleanPointInPolygon(point, country));
    const correct = inside || (!selected && pointToPolygonDistance(point, this.country, { units: 'kilometers' }) <= 25);
    this.attempts.push({
      countryId: this.country.properties.id,
      skill: 'name-to-location',
      boundaryVersion: 'natural-earth-5.1.2-50m',
      factVersion,
      longitude, latitude, correct,
      selectedCountry: selected?.properties.name ?? null,
      answeredAt: new Date().toISOString(),
    });
    this.save();
  }

  next() {
    if (!this.feedback) return;
    this.state.cursor += 1;
    this.save();
  }
}
