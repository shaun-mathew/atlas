# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root
- `docs/adr/` for ADRs that touch the area being explored

If a referenced file does not exist, proceed silently. The domain-modeling skill creates domain documents lazily when terms or decisions are resolved.

## Layout

This is a single-context repository:

- `CONTEXT.md` contains the geography-learning glossary.
- `docs/adr/` contains system-wide architectural decisions.

## Vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Do not drift to synonyms explicitly marked as avoided.

If a required concept is absent from the glossary, treat that as a signal to revisit the domain model rather than inventing a synonym.

## ADR conflicts

If new work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
