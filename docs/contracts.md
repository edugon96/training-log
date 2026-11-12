# Implementation Contract

The canonical schemas are `contracts/models.ts`. Update schemas, domain validation, client callers, tests and generated OpenAPI together when changing a contract.

## API

All routes below use `/api/v1`. JSON responses are the resource directly, or an array for lists. Errors use `ErrorResponse`.

| Operation | Contract |
|---|---|
| GET /me | `{id, name, email}` |
| GET /catalog | Standard muscles, patterns, equipment types and owned brand/model suggestions. |
| GET /timer-settings | `{revision, presets, soundEnabled, keepScreenAwake}`. Presets are ordered durations in seconds. Unsaved defaults have revision 0. Requires `read`. |
| PUT /timer-settings | `{expectedRevision, value}`. Requires `plans:write`, revision checks, idempotency and audit. Accepts 1–12 distinct presets, each 1–3600 seconds. |
| GET /training-defaults | `{revision, targets}`. An unsaved default has revision 0. |
| PUT /training-defaults | `{expectedRevision, value: {revision, targets}}`. Requires `plans:write`. Existing weeks are unchanged. |
| GET /equipment, /exercises, /weeks, /workouts, /sessions | Full typed arrays, owned records only. Workouts accepts optional `weekId` and `kind`. Sessions accepts optional `weekId` and `workoutId`, combined when both are present. Filters run in PostgreSQL. |
| GET /{resource}/{id} | Typed record |
| POST /{resource} | `{value: Record}`. Client-supplied UUID, revision 0. Server returns revision 1. |
| PUT /{resource}/{id} | `{expectedRevision: number, value: Record}`. Server increments revision. |
| GET /workouts/{id}/deletion, /sessions/{id}/deletion | Returns a deletion confirmation snapshot with title, date, logged-set count and all affected revisions. Requires `read`. Session route accepts standalone logs only. |
| DELETE /workouts/{id} | `{expected: DeletionSnapshot}`. Atomically removes a planned workout and its linked sessions/results. Requires both `plans:write` and `results:write`. |
| DELETE /sessions/{id} | `{expected: DeletionSnapshot}`. Deletes a standalone log and its results. Requires `results:write`. Linked logs must be deleted through their workout. |
| POST /weeks/{id}/copy | `{startDate: "YYYY-MM-DD"}`. Returns new Week. Clone prescriptions, use current saved default targets, never copy sessions. |
| POST /workouts/{id}/start | Legacy convenience action: `{performedOn: "YYYY-MM-DD"}`. Returns snapshot Session with running clock, no inferred actual values. The web client instead creates an idle session via POST /sessions when the first recording action occurs. |
| GET /history | `exerciseId`, optional `routineId`, `before` date. Returns Previous or null. Returns the latest comparable session before the requested date across routines. Matches the current exercise identity or a verified exact history alias. Results follow target order, and optional `targets` supplies set-kind metadata for display and suggestions. |
| GET /history/batch | Repeat `exerciseId` for 1–100 movement IDs, plus optional `routineId` and required `before`. Returns an object keyed by exercise ID, each holding Previous or null. Uses the same matching rules as /history. |
| GET /ledger | `weekId`. Returns Ledger. |
| GET /notification-config | Browser session only. Returns `{configured, publicKey}`. The private VAPID key stays on the server. |
| GET /notification-device | Browser session only. `deviceId` query returns `{deviceId, enabled}` for this owner. |
| PUT /notification-device | Browser session only. `{deviceId, subscription}` enrolls or updates this device's browser push subscription. |
| DELETE /notification-device | Browser session only. `{deviceId}` disables this device and cancels its pending timer notification. |
| PUT /timer-alerts | Browser session only. `{deviceId, sequence, timerId, sessionId, deadline}` replaces the desired notification state. Deadline is epoch milliseconds. Null timerId and deadline cancel it. Returns `{sequence, state, superseded}`. |
| POST /notification-test | Browser session only. `{deviceId}` sends a test push to the enrolled device. Returns `{sent:true}`. |
| GET /changes | Change[] newest first |
| GET /keys | ApiKeyInfo[] |
| POST /keys | `{name, scopes}` returns `{key, info: ApiKeyInfo}`. User sessions only. |
| DELETE /keys/{id} | User sessions only. Returns `{ok:true}`. |
| GET /export | ImportManifest compatible owner export. `format=csv` exports actual results. |
| POST /import | `{manifest: ImportManifest}`. User sessions only, additive and idempotent, conflicts never overwrite. |

Training mutations require an `Idempotency-Key` header. Same owner + key + request returns original response. Reusing key with different request is 409. Revision conflict is 409 with current resource in `error.details.current`. Creation never overwrites an existing ID. All foreign IDs must belong to the actor. Cookie writes require allowed Origin. API key scopes are read, plans:write, results:write and library:write.

Notification routes require a browser session and use desired device state instead of training mutation receipts. Timer sequences are positive, increasing safe integers. An older sequence cannot replace a newer one. Repeating the same sequence and payload is safe, while reusing a sequence with another payload returns 409. Pending notifications support deadlines up to 24 hours ahead and expire one minute after their deadline. Responses are private and not cached.

## Persistence And Counting

Deletion snapshots are read atomically. A changed workout, changed linked session, or new linked session invalidates confirmation with `409 deletion_changed` and a fresh snapshot in `error.details.current`. Obtain new consent before retrying. Successful deletion returns `{workoutId, sessionIds}`. Reusable routines and other workouts are preserved. Owner-scoped deletion markers reject stale creates, updates, imports and old save-receipt replays with `409 record_deleted`. Deleted IDs cannot be reused. Replaying the identical successful deletion request remains idempotent.

Persist equipment, exercises, exercise-muscle relations, weeks, workouts, sessions, result sets, audit events and idempotency receipts in PostgreSQL using Drizzle. Typed block snapshots may use JSONB. Actual sets must also be relational records, not only opaque notes. Authentication tables are managed through Better Auth. Bootstrap owner outside public HTTP registration.

Set credit: only completed results tied to a working, failure or drop target in an item with role `lifting` and non-null primaryMuscle count. Both sides of a unilateral set are one target, not two credits. Do not infer results from completing a session. Plan edits do not mutate session snapshots. Partial/approximate historical facts retain source notes.

Web sessions use `loggingMode: "checked"` and snapshot each item’s `trackingFields`. Typed values remain unlogged until checked. Suggestions only become actuals when accepted. Checked completed rows require every tracked value, and finishing requires every planned row checked or skipped. The start convenience endpoint retains `automatic` logging for compatibility. Automatic sessions may transition to checked logging, while checked sessions cannot downgrade. Legacy explicit sessions retain historical statuses. Optional `userNotes` remain separate from imported `notes`. Target kinds are `working` (Normal), `warmup`, `failure` and `drop`. Blocks accept optional `automaticRest`, defaulting off.

Manifest version 1 accepts optional `trainingDefaults` and `timerSettings` for compatible export and additive restore. Conflicting existing defaults or timer settings are not overwritten. CSV preserves source Notes and exposes User Notes and workout-level equivalents separately.

Exercises accept optional `historyAliases` (up to 100 strict `{exerciseId, equipment, setup}` tuples). Matching uses the entire tuple and never follows aliases transitively. Referenced exercise IDs must belong to the owner, except a self-reference during creation. Aliases are private historical metadata, preserved in owner exports and additive imports. Imports create exercise identities before validating alias references, supporting forward and cyclic references inside the same transaction. Existing session snapshots and ledger assignments remain unchanged.

Workout duration uses `startedAt`, `finishedAt`, optional `timerPausedAt` and optional `pausedDurationMs`. Compare timestamps as instants, not strings. `finishedAt` stops the clock independently of workout status: an active session may retain an end time and unlogged sets. Only completing a checked or automatic session requires every planned set to be resolved. A missing historical start or completed finish means unknown duration. Elapsed time ends at the recorded end, the current pause, or now, then subtracts accumulated pause time. Resume clears an active end time and counts the stopped interval as paused time. Clearing only an active end time has the same behavior. Finishing preserves an existing end time and otherwise records the current time when a start exists. Reset clears start, end and pause state, returning the clock to an idle 0:00 without changing results. Other manual timestamp edits clear pauses. Pause timestamps require an active session with a start and no end. Pause duration cannot exceed the known start-to-pause or start-to-end interval. Concurrent new sets may reopen completed logging while preserving the stopped clock. These fields persist in session JSON and compatible backups without a database migration.

Rest countdown state is client-side and owner-scoped, with absolute deadlines rather than decrementing counters. Browser tabs use session storage. Standalone Home Screen apps also keep a local-storage recovery copy of running and paused timers so a process relaunch can restore them. Expired, cancelled and reset recovery entries are cleared. Rest timer preferences persist through the API. Devices with notifications enabled also persist the latest notification deadline and sequence, without synchronizing the countdown UI across devices. Notification subscriptions are encrypted at rest and excluded from training exports.

The timer-settings API retains `keepScreenAwake` for compatibility. The current web client does not use it to control wake locks. Display preference uses local storage key `training-display:v1:{ownerId}` with `{version: 1, keepScreenAwake: boolean}`, defaulting to true. It is device-local, separate from exports and server settings. The visible signed-in app owns one wake-lock lifecycle independently of rest timers.

Items accept optional `noteEntries` (ordered `{id, text}` rows) and `repetitionMode` (`exact` or `range`). Legacy text remains readable and is projected from structured notes on save, retaining import provenance. Session-only notes live in `movementNotes`, keyed by an existing item ID. Note IDs must be unique within each item. Session note changes do not mutate the source plan, including changes before the first result. Cloning regenerates creation-note IDs. Removing a movement prunes its session notes. These optional fields remain part of JSONB snapshots and JSON exports without a database migration.

## UI Integration

Use `lib/api-client.ts`, `lib/offline.ts` and `lib/workout-edits.ts` for platform operations. No server imports or direct fetch to workout endpoints from components. Better Auth sign-in uses `/api/auth/sign-in/email` through a client helper. No public signup UI. The API is independent of the screen.

Web client methods are defined in `lib/api-client.ts`. Read that module for the current operation names and input types.

Save methods accept a full Record and decide POST vs PUT from `revision === 0`. They return the updated Record. `previous(exerciseId, routineId, before)` returns PreviousRecord.

Session edits are accepted by `queueSession(ownerId, session, previous, delayMs)` after durable local persistence. Workout edits use `queuePlanEdit` or `savePlanEdit` with the previous optimistic value. Both queues retain the last acknowledged baseline and an immutable outgoing request. A single foreground coordinator serializes each owner’s saves with browser locks, retries with bounded backoff, and resumes on reconnect, focus and visibility. An uncertain response retries the identical request and idempotency key. A definite revision conflict merges changed fields onto `error.details.current` and uses a new key. Independent changes survive. For the same field, the last accepted server save wins. Group, movement, set and note identities preserve additions, deletions, movement transfers and ordering. Results merge by target identity without duplicate set rows. Deletion remains terminal.

Workout editors retain raw drafts in IndexedDB, including invalid/incomplete fields. Valid plan changes use `savePlanEdit` and a serialized, idempotent queue. Existing-workout structural edits save immediately. Text and numeric fields debounce for 450 ms. New workouts and routines persist only on explicit Save with a valid title. Opening, typing, reconnecting and leaving an unsubmitted creation draft never submit it. After Save is requested, its durable request may retry on reconnect with the same identity. Valid edits retry automatically. Navigation waits only for device persistence. Routine saves are silent. A muted, tappable cloud icon communicates offline use or an actionable save problem without routine conflict dialogs. Validation, authentication and device-storage failures remain actionable. Session structure changes use the session queue after recording starts. Deletion is online-only and purges local drafts, queues, history caches and linked timers after server confirmation.

Before recording starts, workout-screen structural changes use the plan queue. After recording starts, changes use the session queue and preserve the original plan. Edits made while a request is in flight are merged over its acknowledgement and remain queued. Legacy drafts without a baseline are archived locally rather than inferred to be fresh whole-record changes. Legacy group order can be recovered over surviving server groups without copying stale contents. New edits made during recovery retain their own baseline and save automatically. Raw incomplete editor fields and completed-result corrections remain local until valid. New workouts still require explicit Save.
