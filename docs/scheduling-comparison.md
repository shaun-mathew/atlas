# Recommended practice and FSRS

## Recommended practice now mixes all three skills

Recommended practice selects name-to-location, location-to-name recognition, and shape recognition without requiring a switch to Custom practice. Each country-and-skill combination retains its own proficiency and FSRS review schedule.

Selection policy:

1. Introduce countries through name-to-location, retaining the recognizable anchors (Brazil, China, Australia, India, etc.), then larger-to-smaller landmasses.
2. New recognition exercises become eligible when that country's name-to-location proficiency is Familiar or Retained. Wrong or assisted introductions do not unlock them. Existing recognition history remains reviewable even without a qualifying recall history.
3. Temporarily exclude countries appearing in the two most recent supported answers, provided those answers are less than ten minutes old. This applies across skills: an answer reveals name, outline and location, so another skill for the same country should not immediately test that exposure. Another two answers or the ten-minute window releases the exclusion; deadlines are not changed.
4. Among eligible questions, prioritize the earliest scheduled review across all three skills. Equal due dates use stable skill order: name-to-location, location-to-name recognition, shape recognition.
5. With no eligible due review, select the skill with the fewest supported attempts that has an eligible question, using the same stable tie order. Within each skill, keep the existing introduction order and practice-revisit policy. This balances practice while continuing to introduce new countries.

For a fresh learner answering correctly in one sitting, the opening sequence is locate Brazil, locate China, locate Australia, recognize Brazil's highlighted location, then recognize China's silhouette. Subsequent questions depend on answers, elapsed time, existing history and due reviews; this is not a fixed script.

Location recognition uses searchable candidates. Shape recognition uses an isolated silhouette without map context, also answered through searchable candidates. Neither is described as free recall. Recommended practice displays the active skill; Custom practice remains a single-skill, geographically filtered alternative. Fact reading remains unscored. Switching modes preserves paused questions and assistance metadata.

## Curated city and capital introductions

City introductions use the editorial curriculum in `src/city-introductions.ts`, rather than the fact bundle's dataset order. It assigns all 324 cities to four ordered tiers:

1. **Familiar landmarks (40):** recognizable reference points across inhabited continents. New introductions begin London, Tokyo, New York City, Paris, Sydney, Cairo and Rio de Janeiro.
2. **Regional anchors (79):** expand around those reference points with cities such as Dublin, Kyoto, Marrakesh, Chicago, Santiago and Melbourne.
3. **Broader coverage (154):** less familiar capitals, secondary cities and capital-role contrasts.
4. **Specialist places (51):** smaller states, remote islands and administrative centres.

Order within the tiers mixes regions. These are editorial judgments about a useful learning sequence, not measured difficulty, universal familiarity, population or GDP rankings. Geographic filters retain the relative order of eligible cities; a regional session starts with its own familiar reference points rather than requiring worldwide progression.

National-capital name-to-location practice uses the shared city order filtered to the 205 supported capital targets. Country-to-capital location has a separate 38-relationship opening: familiar relationships first, then contrasts such as Australia–Canberra, Canada–Ottawa and Brazil–Brasília. Remaining capitals follow their shared city tiers. This deliberately distinguishes recognizing a city's name from knowing that it is a country's capital; existing role-specific prompts still distinguish multiple capital seats.

Only selection of **unseen** learning items changes. Due reviews still take priority, weak-item practice revisits still interleave, and the dataset order still breaks review ties. Existing unanswered questions, assistance, attempts, proficiency and review dates are preserved. A learner with saved progress will therefore not necessarily see the opening sequence on refresh.

The curriculum references stable city IDs outside the immutable fact release. Reordering introductions does not change geographic facts, assessment tolerance, learning-item identity or content versions. Catalogue additions must be explicitly assigned to a tier; coverage tests exercise introductions through the public learner session for cities and both capital skills.

## Why FSRS instead of the previous schedule?

| Approach | Strength | Limitation for Atlas |
| --- | --- | --- |
| Previous fixed 1/3/7/14/30-day ladder | Small, deterministic and easy to explain. | No memory-strength or difficulty model; equally successful on-time and overdue reviews advance identically; 30-day ceiling; failure resets the interval. |
| Box/Leitner-style scheduling | Straightforward progression through preset review intervals. | Conceptually close to the fixed ladder, without continuous memory estimates. Atlas was not an implementation of Leitner's original system. |
| Legacy Anki/SM-2 | Per-item ease and grade-dependent progression. | More adaptive than a fixed ladder but not the modern FSRS memory model. |
| Modern Anki/FSRS | Models difficulty, stability and time-dependent retrievability; intervals target desired retention. | Adds dependency/model complexity, migration effects and uncertainty about calibration for our geography exercises. |

Anki describes FSRS as an alternative to its legacy SuperMemo-2 scheduler in its [official deck options](https://docs.ankiweb.net/deck-options.html#fsrs). See also the [legacy scheduler source](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/states/review.rs) and [FSRS algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm). The accessible [Leitner overview](https://en.wikipedia.org/wiki/Leitner_system) is secondary; the comparison above is conceptual.

Recommendation: use FSRS for review timing while retaining our geography grading and introduction order. No measured improvement in geography learning is claimed.

## Implemented FSRS policy

`src/scheduler.ts` uses pinned `ts-fsrs@5.4.2` (FSRS-6) with default model weights, 90% desired retention, fuzz disabled, and one ten-minute learning/relearning step. For new and scheduled questions, unassisted correct answers map to Good; wrong or assisted answers map to Again. Anki explicitly permits an Again/Good-only workflow in its [answer-button guidance](https://docs.ankiweb.net/studying.html#answer-buttons). See [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) and [Anki learning steps](https://docs.ankiweb.net/deck-options.html#learning-steps) for the engine and step semantics.

First successful learning or recovery is Familiar; a subsequent successful review is Retained. These labels describe demonstrated proficiency, not a calculated recall percentage. Immediate retries and practice revisits cannot earn retention credit or postpone review. The existing repeated-shape-miss rule can bring a check forward without discarding learned memory state; if no memory exists, repeated misses establish an initial failed observation.

The 90% figure is a model target, not measured accuracy. Parameters are general defaults, not weights fitted to our map, silhouette or searchable-recognition tasks. Binary grading omits Hard/Easy effort distinctions. Ignoring extra practice as retention evidence preserves our assessment contract but omits those exposures from the model. Independent skill states prevent direct proficiency leakage, but do not eliminate transfer between skills.

## Persistence and rollout

Attempts remain the durable source of truth. Existing schema migration, stable chronological ordering, deduplication and account merge are preserved. Supported history is replayed using inferred Good/Again ratings; old review dates are recalculated. Default weights cannot recover effort ratings or memory state that older history never recorded. Pinning the library and disabling fuzz make replay deterministic under this policy.

The user is comfortable starting fresh, but this implementation does not silently delete progress. Use the existing Reset learning progress flow to start over. If retaining real account data when deploying, back it up and accept the scheduling migration explicitly. Future library/parameter changes must also be treated as replay migrations. Anki warns about bulk due-date changes in its [rescheduling guidance](https://docs.ankiweb.net/deck-options.html#reschedule-cards-on-change).

Optimizer training, daily workload limits, sibling burial for an entire day, leech handling and self-grading controls are not part of this change. Our short exposure exclusion is a question-selection policy, not an Anki-equivalent burying implementation. Evaluate representative review history before claiming calibration or training parameters; see [Anki's parameter guidance](https://docs.ankiweb.net/deck-options.html#fsrs-parameters).
