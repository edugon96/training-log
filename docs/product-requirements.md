# Training Platform

## Purpose

Give the owner one reliable place to plan and record training. The platform stores structured workout data and exposes it through an API. The first web client makes that data practical to use on a phone in the gym.

## Scope

The first release supports one privately provisioned owner. Every record is owner-scoped so future clients and accounts can share the same platform design. Native apps, public signup, payments, social features, wearable integrations and advanced WOD timers are outside this release.

## Users And Jobs

| User | Job | Outcome |
|---|---|---|
| Owner | Repeat a useful training week and adjust it | Familiar structure with clear changes |
| Owner | Log a workout on a phone | Previous performance, targets and actuals remain separate |
| Owner | Change exercises or equipment during training | The performed record reflects what happened |
| Owner | Review training coverage | Planned and completed muscle sets are visible |
| Authorized agent | Read history and update agreed plans | Changes are attributed and revision-checked |
| Future client developer | Build another interface | No dependency on this web client's components |

## Capabilities

### Library

Exercises have a name, movement pattern, primary ledger category, secondary anatomy, role, equipment and setup. Muscles, patterns, equipment types and roles use standard choices. Brand and model support searchable selection and new values. Equipment stores name, type, brand, model and starting resistance independently of added load. Unknown units and load basis stay unknown. Archive library records without removing history.

Each movement defines the fields needed for logging: reps, weight, time or distance. The library is searchable and filterable by muscle and equipment type.

### Planning

Workout names describe the training focus, such as Upper or Quad-Focused Lower. Dates and weekdays belong in the dedicated date field and calendar display, not the name. Apply this convention when creating, importing or repeating plans. Logged sessions use the same concise naming convention.

A week contains dated planned workouts and a snapshot of muscle targets. Saved training goals supply the targets for new and repeated weeks. Updating defaults leaves existing weeks unchanged. A week can have an explicit override or adopt saved defaults. Reusable routines provide starting points. A workout contains ordered straight-set, superset or circuit blocks. Blocks retain rest, round and exercise order. Each movement has its own target sets, allowing uneven superset counts.

Preparation, power, lifting, conditioning and cooldown all belong in the same workout. Numerical fields include repetitions, load, time, distance and RIR. Notes preserve details that cannot be represented precisely.

### Logging

Opening a workout shows its logging screen without starting the clock or creating actuals. The first recording action creates a prescription snapshot. The snapshot remains stable when the original plan changes. Previous performance shows the latest comparable session before the workout date, including a newer session from another routine or earlier in the same week. Exercise and setup must match. Adding a movement loads its history immediately. Machine movements include weight entry by default unless tracking fields were explicitly configured otherwise.

Actual results are entered per set. A set is complete when all its configured fields have values. Zero load is valid, while reps, time and distance must be positive. No Done action is required. The user can skip or undo skipping a set and add sets during the workout. New sets copy the prescription and start with empty actuals.

Finishing reviews incomplete rows. The user can return to logging or explicitly mark remaining rows skipped and finish. Partial entries remain stored. Historical sessions keep their recorded status unless a row is edited. Corrections preserve an attributed audit trail.

Set notes are optional and opened on demand. Imported commentary stays stored but hidden from the ordinary workout interface. Useful block instructions render safe Markdown separately from the structured title, rounds and rest.

### Presentation

The web client uses neutral charcoal surfaces, a green primary accent and Golos Text. Controls share consistent alignment, sizing and focus states. Compact set rows keep previous results, targets and actual inputs distinct. Supersets are visually grouped. Small screens retain usable input and action sizes without page-wide horizontal scrolling.

The desktop sidebar collapses to an icon rail and remembers the preference. Phone and tablet layouts use bottom tabs with safe-area spacing. Mobile forms open as bottom sheets. Secondary muscles use a searchable multi-select with removable chips. Workout blocks can collapse independently while entered values remain intact. Set logging autosaves silently. A muted cloud icon provides details when offline or when saving needs attention.

Set logging uses compact rows with shared headers for the set number, previous result, and tracked values. Weight and reps stay on the same row on mobile. A shared prescription appears above the rows, with per-set targets shown when they differ. Units, optional notes, and skip actions are available without crowding the default view.

Equipment names describe the machine. Brand and model are separate fields shown once beside the name. Label cleanup preserves equipment IDs, starting resistance, source notes and historical workout snapshots.

#### Home

Home greets the owner by first name and displays the selected week's progress above compact workout cards. The summary shows distinct planned workouts completed, logged time from completed sessions excluding explicit pauses, and eligible completed working sets. Missing historical durations remain unknown. Partial time coverage is labeled. Offline progress is identified as the last loaded view.

The current calendar week is selected when available, otherwise the latest week. An explicit selected week or direct link takes precedence. A compact selector switches weeks. The adjacent menu contains Muscle ledger, Week details, Repeat week, New workout, Add from routine and New week. The ledger opens separately with Plan, Done and Goal columns plus week-target editing. Reusable Training goals live in Profile.

Each compact card shows a vertically centered date, title, movement/set counts and status. Cards open the actual workout screen. Completed sessions open read-only with corrections available from the workout menu. Today uses a consistent full-card highlight. There is no separate preview or automatic clock start.

#### Display

The header remains in document flow and scrolls out of view. Vertical overscroll and pull-to-refresh are suppressed where supported. Controls retain keyboard access, visible focus and touch targets. Reduced-motion preferences suppress Home transitions and dialog animation.

Keep screen awake defaults on throughout the visible signed-in app. Settings exposes an account-scoped, device-local preference. The client releases the wake lock when hidden, disabled or signed out, and requests it again on return, page restoration and user interaction. An unexpected release permits one delayed recovery attempt per foreground or interaction cycle. Unsupported browsers and device-denied requests produce quiet status feedback without repeated retries. Manual locking and power-saving controls remain authoritative.

Visible rest countdowns play three nonverbal beeps at three, two and one seconds remaining, then a distinct buzz at zero. Timer changes cancel obsolete cues immediately. Profile provides Test sound. Each device can opt into completion notifications through a direct permission gesture. Background notifications use the operating system's standard alert, expire after one minute and never block timer or workout operation. Scheduling uses durable jobs, without polling the training database.

### Offline Use

An opened session is stored on the device. Session edits are saved locally before upload. Failed requests retain an idempotent retry. Conflicting changes require choosing the local or server version. Logging does not depend on the connection staying available.

The browser must have opened the application and session online first. First-time login, new session creation, plan editing and library editing require a connection. Local caches contain personal training data, so the initial prototype is intended for a trusted personal device.

### Volume Ledger

The starting allocation is 111 working sets. Each eligible set receives one primary muscle credit. Secondary anatomy is descriptive. Preparation, power, conditioning and cooldown do not automatically add hypertrophy credit.

| Muscle | Target |
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

### Agent Access And Portability

The owner creates named, scoped, revocable API keys. Plan, result and library writes have separate scopes. Every mutation is idempotent and revision-checked. Full JSON exports support additive restore. CSV exports expose actual results.

## Historical Data

Optional reviewed imports preserve source excerpts, source hashes, units, substitutions and uncertainty. Plans and previous-performance columns never become actuals automatically. Personal source files remain outside the repository. Import tests use synthetic history.

## Acceptance Criteria

1. A user can copy a week, change blocks and targets, then start a workout without copying completed results.
2. A user can record distinct sets in an uneven superset and retrieve the exact results after refresh.
3. A plan edit does not change an existing session snapshot.
4. Offline edits survive reload and synchronize without duplicates.
5. Concurrent workout edits merge automatically. Changes to different fields survive, and the last save accepted by the server wins for the same field. Saving never blocks normal navigation after device persistence.
6. Owner isolation and scoped keys are enforced by the API.
7. The ledger distinguishes planned sets, completed eligible sets and unknown results.
8. Export and restore preserve structured data and source evidence.
9. The mobile layout is usable without page-wide horizontal scrolling.

## Adoption

The hosted app is the operational training log. Historical Markdown and Notion records remain evidence for earlier training. Local development data is separate. The app's API supports future workout planning without requiring a second publishing system.
