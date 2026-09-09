import { z } from 'zod';
import { countries, introductionOrder } from './geography';
import { facetSelectionSchema, matchesFacets } from './facets';

export const boundaryVersion = 'natural-earth-5.1.2-50m';
const firstFactVersion = '2026-09-07';
const countryIdSchema = z.string().min(1).max(128);
const questionKindSchema = z.enum(['new', 'review', 'practice', 'retry']);
const spatialSkillSchema = z.enum(['name-to-location', 'location-to-name-recognition']);
const previousKindSchema = questionKindSchema.or(z.literal('diagnostic'))
  .transform(kind => kind === 'diagnostic' ? 'new' as const : kind);
const questionSchema = z.object({
  countryId: countryIdSchema,
  skill: spatialSkillSchema.default('name-to-location'),
  kind: questionKindSchema,
  assisted: z.boolean().default(false),
});
const attemptSchema = z.object({
  id: z.string().min(1).max(256),
  countryId: countryIdSchema,
  skill: z.string().min(1).max(128),
  boundaryVersion: z.string().min(1).max(128),
  // The first fact release also describes attempts made before fact cards existed.
  factVersion: z.string().min(1).max(128).default(firstFactVersion),
  longitude: z.number().min(-180).max(180).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  correct: z.boolean(),
  assisted: z.boolean().default(false),
  selectedCountry: z.string().max(256).nullable(),
  selectedCountryId: countryIdSchema.optional(),
  answeredAt: z.iso.datetime().transform(value => new Date(value).toISOString()),
  kind: questionKindSchema,
});
const normalizedProgressSchema = z.object({
  version: z.literal(7),
  selection: facetSelectionSchema.nullable().default(null),
  readingCountryId: countryIdSchema.nullable().default(null),
  pausedQuestions: z.array(questionSchema).default([]),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  current: questionSchema.nullable(),
  attempts: z.array(attemptSchema),
});

export type Progress = z.infer<typeof normalizedProgressSchema>;
export type Attempt = Progress['attempts'][number];
type Question = NonNullable<Progress['current']>;
export type SpatialSkill = Question['skill'];
export function learningItemKey(item: { countryId: string; skill: string }): string {
  return `${item.countryId}:${item.skill}`;
}

export class ProgressConflictError extends Error {
  constructor(id: string) {
    super(`Attempt ${id} conflicts with saved history.`);
    this.name = 'ProgressConflictError';
  }
}

export function initialProgress(): Progress {
  return {
    version: 7, selection: null, readingCountryId: null, pausedQuestions: [], started: false, cursor: 0, attempts: [],
    current: { countryId: introductionOrder[0].properties.id, skill: 'name-to-location', kind: 'new', assisted: false },
  };
}

const savedAttemptSchema = attemptSchema.extend({ id: attemptSchema.shape.id.optional() });
const savedProgressSchema = normalizedProgressSchema.extend({ attempts: z.array(savedAttemptSchema) });
const previousProgressSchema = savedProgressSchema.extend({
  version: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  current: questionSchema.extend({ kind: previousKindSchema }).nullable(),
  pausedQuestions: z.array(questionSchema.extend({ kind: previousKindSchema })).default([]),
  attempts: z.array(savedAttemptSchema.extend({ kind: previousKindSchema })),
}).transform(state => ({ ...state, version: 7 as const }));
const legacyProgressSchema = z.object({
  version: z.literal(1),
  started: z.boolean(),
  cursor: z.number().int().nonnegative(),
  attempts: z.array(savedAttemptSchema.omit({ kind: true })),
}).refine(state =>
  (state.attempts.length === state.cursor || state.attempts.length === state.cursor + 1)
  && (state.started || (state.cursor === 0 && state.attempts.length === 0))
  && state.attempts.every((attempt, index) => attempt.countryId === countries[index % countries.length].properties.id),
).transform(state => ({
  ...initialProgress(), ...state, version: 7 as const,
  current: {
    countryId: countries[state.cursor % countries.length].properties.id,
    skill: 'name-to-location' as const,
    kind: 'new' as const,
    assisted: state.attempts[state.cursor]?.assisted ?? false,
  },
  attempts: state.attempts.map(attempt => ({ ...attempt, kind: 'new' as const })),
}));

// Hash only migrated rows. Including their original index preserves repeated
// equal answers, while repeated imports of the same old save get the same IDs.
// A hash collision is detected as conflicting content, never silently dropped.
function legacyAttemptId(attempt: Omit<Attempt, 'id'>, index: number): string {
  const content = attemptContent(attempt);
  let hash = 0xcbf29ce484222325n;
  for (let position = 0; position < content.length; position++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(content.charCodeAt(position))) * 0x100000001b3n);
  }
  return `attempt-${index.toString(36).padStart(10, '0')}-${hash.toString(16).padStart(16, '0')}`;
}

function attemptContent(attempt: Omit<Attempt, 'id'>): string {
  return JSON.stringify([
    attempt.countryId, attempt.skill, attempt.boundaryVersion, attempt.factVersion,
    attempt.longitude, attempt.latitude, attempt.correct, attempt.assisted,
    attempt.selectedCountry, attempt.answeredAt, attempt.kind,
    // Keep old migrated IDs stable: extend the hash only for identity answers.
    ...(attempt.selectedCountryId === undefined ? [] : [attempt.selectedCountryId]),
  ]);
}

function unionAttempts(attempts: Attempt[]): Attempt[] {
  const byId = new Map<string, Attempt>();
  for (const attempt of attempts) {
    const previous = byId.get(attempt.id);
    if (previous && attemptContent(previous) !== attemptContent(attempt)) throw new ProgressConflictError(attempt.id);
    if (!previous) byId.set(attempt.id, attempt);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const progressSchema = z.union([savedProgressSchema, previousProgressSchema, legacyProgressSchema])
  .superRefine((state, context) => {
    const answer = state.attempts[state.cursor];
    const readingCountry = state.readingCountryId === null ? undefined
      : countries.find(country => country.properties.id === state.readingCountryId);
    for (const attempt of state.attempts) {
      const recognition = attempt.skill === 'location-to-name-recognition';
      if (recognition
        ? attempt.selectedCountryId === undefined || attempt.longitude !== undefined || attempt.latitude !== undefined
        : attempt.longitude === undefined || attempt.latitude === undefined) {
        context.addIssue({ code: 'custom', message: 'An answer must contain a selected entity or a geographic point for its skill.' });
      }
    }
    if (state.cursor > state.attempts.length
      || (!state.started && (state.cursor !== 0 || state.attempts.length !== 0))
      || new Set(state.pausedQuestions.map(learningItemKey)).size !== state.pausedQuestions.length
      || state.pausedQuestions.some(question => state.current && learningItemKey(question) === learningItemKey(state.current))
      || (state.selection?.learning === 'country-facts'
        && (!readingCountry || !matchesFacets(readingCountry, state.selection)))
      || (answer && (answer.countryId !== state.current?.countryId || answer.kind !== state.current.kind
        // Unsupported historical skills remain durable; session replay skips
        // them and selects a supported prompt rather than discarding the save.
        || ((answer.skill === 'name-to-location' || answer.skill === 'location-to-name-recognition') && answer.skill !== state.current.skill)))) {
      context.addIssue({ code: 'custom', message: 'Progress has an inconsistent active question or answer.' });
    }
  }).transform((state, context): Progress => {
    const withIds = state.attempts.map((attempt, index) => ({
      ...attempt, id: attempt.id ?? legacyAttemptId(attempt, index),
    }));
    const answerId = withIds[state.cursor]?.id;
    let attempts: Attempt[];
    try {
      attempts = unionAttempts(withIds);
    } catch (error) {
      if (!(error instanceof ProgressConflictError)) throw error;
      context.addIssue({ code: 'custom', message: error.message });
      return z.NEVER;
    }
    return {
      ...state, attempts,
      cursor: answerId === undefined ? attempts.length : attempts.findIndex(attempt => attempt.id === answerId),
    };
  });

// Without question IDs, unfinished prompts for one learning item are conservatively
// one prompt: help is never forgotten, and retry/practice cannot become retention.
const kindRank: Record<Question['kind'], number> = { retry: 0, practice: 1, new: 2, review: 3 };
function mergeQuestion(left: Question, right: Question): Question {
  return {
    countryId: left.countryId,
    skill: left.skill,
    kind: kindRank[left.kind] < kindRank[right.kind] ? left.kind : right.kind,
    assisted: left.assisted || right.assisted,
  };
}

export function mergeProgress(account: Progress, incoming: Progress): Progress {
  const saved = progressSchema.parse(account);
  const received = progressSchema.parse(incoming);
  const attempts = unionAttempts([...saved.attempts, ...received.attempts]);
  // Attaching an untouched guest must not replace an account's learning screen.
  const active = received.started || !saved.started ? received : saved;
  const answerId = active.attempts[active.cursor]?.id;
  const pending = new Map<string, Question>();
  const exposed = new Set<string>();
  for (const state of [saved, received]) {
    if (state.current?.assisted) exposed.add(state.current.countryId);
    if (state.selection?.learning === 'country-facts' && state.readingCountryId) exposed.add(state.readingCountryId);
    const questions = state.started && state.current && state.cursor === state.attempts.length
      ? [...state.pausedQuestions, state.current] : state.pausedQuestions;
    for (const question of questions) {
      const key = learningItemKey(question);
      const previous = pending.get(key);
      pending.set(key, previous ? mergeQuestion(previous, question) : { ...question });
      if (question.assisted) exposed.add(question.countryId);
    }
  }
  let current = active.current ? { ...active.current } : null;
  if (current) {
    const question = pending.get(learningItemKey(current));
    if (question && answerId === undefined) current = mergeQuestion(current, question);
    current.assisted ||= exposed.has(current.countryId);
    pending.delete(learningItemKey(current));
  }
  const pausedQuestions = [...pending.values()].map(question => ({
    ...question, assisted: question.assisted || exposed.has(question.countryId),
  })).sort((a, b) => learningItemKey(a).localeCompare(learningItemKey(b)));
  return {
    ...active, started: saved.started || received.started, current, pausedQuestions, attempts,
    cursor: answerId === undefined ? attempts.length : attempts.findIndex(attempt => attempt.id === answerId),
  };
}
