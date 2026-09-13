import { z } from 'zod';

export interface FactSource {
  title: string;
  url: string;
  retrievedAt: string;
  license: string;
}

export interface FactRelease<T extends { sourceIds: readonly string[] }> {
  version: string;
  reviewedAt: string;
  facts: Record<string, T>;
  sources: Record<string, FactSource>;
  provenance: Record<string, { referenceYear: number | null; geographicScope: string }>;
  changes: readonly { entityId: string; skills: readonly string[]; reason: string }[];
}

const nonemptyText = z.string().trim().min(1);
const releaseSchema = z.object({
  version: nonemptyText,
  reviewedAt: z.iso.date(),
  facts: z.record(nonemptyText, z.object({
    sourceIds: z.array(nonemptyText).min(1),
  }).passthrough()).refine(facts => Object.keys(facts).length > 0),
  sources: z.record(nonemptyText, z.object({
    title: nonemptyText,
    url: z.url({ protocol: /^https?$/ }),
    retrievedAt: z.iso.date(),
    license: nonemptyText,
  })),
  provenance: z.record(nonemptyText, z.object({
    // Null explicitly means the source does not establish a reference year.
    referenceYear: z.number().int().min(1).max(9999).nullable(),
    geographicScope: nonemptyText,
  })),
  changes: z.array(z.object({
    entityId: nonemptyText,
    skills: z.array(z.enum(['name-to-location', 'capital-to-location', 'location-to-name-recognition', 'shape-recognition'])).min(1),
    reason: nonemptyText,
  })),
});

interface ReviewedFacts<T> {
  facts: T;
  sources: readonly FactSource[];
  referenceYear: number | null;
  geographicScope: string;
  reviewedAt: string;
}

function freezeSnapshot(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error('Reviewed facts must contain only plain structured data.');
  }
  Object.freeze(value);
  for (const child of Object.values(value)) freezeSnapshot(child);
}

export class FactReleases<T extends { sourceIds: readonly string[] }> {
  readonly #releases: readonly FactRelease<T>[];
  readonly #versions = new Map<string, number>();
  readonly #cards: readonly Map<string, ReviewedFacts<T>>[];

  constructor(releases: readonly FactRelease<T>[]) {
    if (!releases.length) throw new Error('At least one reviewed fact release is required.');
    releases = structuredClone(releases);
    releases.forEach((release, index) => {
      releaseSchema.parse(release);
      if (this.#versions.has(release.version)) throw new Error(`Duplicate fact version: ${release.version}`);
      for (const [id, facts] of Object.entries(release.facts)) {
        if (!Object.hasOwn(release.provenance, id)) throw new Error(`Missing fact provenance: ${id}`);
        for (const sourceId of facts.sourceIds) {
          if (!Object.hasOwn(release.sources, sourceId)) throw new Error(`Missing fact source: ${sourceId}`);
        }
      }
      for (const source of Object.values(release.sources)) {
        if (source.retrievedAt > release.reviewedAt) throw new Error('A fact source must be retrieved before review.');
      }
      for (const change of release.changes) {
        if (!Object.hasOwn(release.facts, change.entityId)) throw new Error(`Unknown changed entity: ${change.entityId}`);
      }
      this.#versions.set(release.version, index);
    });
    freezeSnapshot(releases);
    this.#releases = releases;
    this.#cards = releases.map(release => new Map(Object.entries(release.facts).map(([id, facts]) => [
      id,
      Object.freeze({
        facts,
        sources: Object.freeze(facts.sourceIds.map(sourceId => release.sources[sourceId])),
        ...release.provenance[id],
        reviewedAt: release.reviewedAt,
      }),
    ])));
  }

  get currentVersion(): string {
    return this.#releases[this.#releases.length - 1].version;
  }

  get(id: string, version: string): ReviewedFacts<T> {
    const index = this.#versions.get(version);
    if (index === undefined) throw new Error(`Unknown fact version: ${version}`);
    const card = this.#cards[index].get(id);
    if (!card) throw new Error(`Missing facts: ${id}`);
    return card;
  }

  has(id: string, version: string): boolean {
    const index = this.#versions.get(version);
    return index !== undefined && Object.hasOwn(this.#releases[index].facts, id);
  }

  reviewAfter(id: string, skill: string, version: string): string | undefined {
    const index = this.#versions.get(version);
    if (index === undefined || !this.#cards[index].has(id)) return undefined;
    // Registration order is release order; review dates need not differ.
    for (let later = this.#releases.length - 1; later > index; later--) {
      const release = this.#releases[later];
      if (release.changes.some(change => change.entityId === id && change.skills.includes(skill))) {
        return `${release.reviewedAt}T00:00:00.000Z`;
      }
    }
    return undefined;
  }
}
