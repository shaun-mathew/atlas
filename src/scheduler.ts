import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs';
import type { Attempt } from './progress';

export type Proficiency = Card & {
  level: 'Learning' | 'Familiar' | 'Retained';
  intervalDays: number;
  dueAt: string;
};

// Pin the library and policy together so history replays identically across
// devices. Immediate retries do not substitute for the delayed learning check.
const scheduler = fsrs({
  request_retention: 0.9,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['10m'],
  relearning_steps: ['10m'],
});

export function scheduleReview(previous: Proficiency | undefined, attempt: Attempt): Proficiency {
  const now = new Date(attempt.answeredAt);
  const success = attempt.correct && !attempt.assisted;
  const { card } = scheduler.next(previous ?? createEmptyCard(now), now, success ? Rating.Good : Rating.Again);
  return {
    ...card,
    level: !success ? 'Learning' : previous && previous.level !== 'Learning' ? 'Retained' : 'Familiar',
    intervalDays: card.scheduled_days,
    dueAt: card.due.toISOString(),
  };
}
