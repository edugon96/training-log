# Training Model

## Purpose

Keep prescriptions, performed work and training goals distinct. A useful plan can repeat across weeks while loads, repetitions, exercise choices and recovery needs change.

## Scope

The platform stores training decisions and counts structured work. It does not diagnose injuries, calculate an individual's optimal volume, or automatically prescribe progression. The included Hybrid Hypertrophy profile is an editable starting allocation for an experienced lifter, not a universal recommendation.

## Planning Structure

A week holds dated workouts and a snapshot of its muscle targets. A reusable routine is undated. Workouts contain ordered blocks of straight sets, supersets or circuits. Each movement has its own set count, so a paired block can contain unequal counts.

Use a clear sequence: preparation and skill work, power when included, main lifts, accessories, then conditioning. Exercise roles control counting. A low-repetition jump and a hard row can be valuable without becoming hypertrophy credits.

Choose supersets for manageable local fatigue and practical equipment access. Keep demanding lifts separate when pairing reduces their quality. A superset is an ordering choice, not permission to omit needed rest. Keep familiar movements stable enough to compare performance, then make deliberate substitutions.

## Muscle Ledger

Each eligible working set receives **one primary muscle credit**. Secondary anatomy describes involvement without adding fractional or duplicate credits. Three unilateral sets performed on both sides count as three targets, not six.

| Column | Meaning |
|---|---|
| Goal | The week's selected target for a muscle |
| Plan | Working targets in dated workout items with role `lifting` |
| Done | Completed results tied to eligible working targets in session snapshots |

Warm-ups, preparation, power, conditioning and cooldown are excluded. Finishing a workout does not fill missing sets. Skipped or unlogged sets receive no completed credit. Add an actual extra set through the workout interface so it has a structured target and can be counted.

This ledger is a planning convention. A squat involves more than its primary category, and a press also trains the triceps. Do not interpret totals as a complete measurement of muscle stimulus or recovery cost. Training outside the ledger still matters.

## Hybrid Hypertrophy Profile

The [importable example](../examples/hybrid-hypertrophy.json) uses this allocation:

| Muscle | Sets |
|---|---:|
| Chest | 14 |
| Back | 14 |
| Front delts | 3 |
| Side delts | 10 |
| Rear delts | 6 |
| Biceps | 9 |
| Triceps | 9 |
| Quads | 14 |
| Hamstrings | 10 |
| Glutes | 4 |
| Calves | 6 |
| Abs | 6 |
| Obliques | 6 |
| Total | 111 |

The illustrative week uses five lifting days and a separate athletic day. Its lifts generally use three or four working sets per movement. The example demonstrates accounting and structure, not an obligation to complete 111 sets. Choose loads and effort appropriate to the person, and reduce the allocation when needed.

Reusable goals live in Profile. New and repeated weeks use saved defaults. Each week can override them. Changing defaults never rewrites old weeks. The example includes no actuals, personal performance history or clinical information. It uses the existing Profile import flow. Conflicting existing defaults are rejected rather than silently replaced.

## Progression And Review

Compare like-for-like performance: movement, equipment, setup, load basis and date. Use previous results as evidence, not as newly completed sets. Keep loads and repetitions editable. Review progression, effort, recovery and adherence before adding work just to fill a gap.

The athlete and planner decide the next increment together. Review the whole week after changes, especially when a class, sprint session or missed day changes recovery demands. The platform does not redistribute missed volume automatically.

## Exercise Identity

Equipment stores name, brand, model and starting resistance separately. Exercise setup stores grip, attachment, stance and other known variation. Unknown details remain unknown. Added plates are not automatically combined with listed starting resistance. Changing a unit label does not convert the recorded number.

Historical session snapshots keep original wording and muscle assignments. A verified library correction may add an exact `historyAliases` tuple so previous results remain discoverable. Aliases must identify the same performed movement. They never justify treating seated and lying curls, different machines or assisted and unassisted movements as equivalent.
