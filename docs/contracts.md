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
| GET /equipment, /exercises, /weeks, /workouts, /sessions | Full typed arrays, owned records only. Workouts accepts optional `weekId` and `kind`. Sessions accepts optional `weekId`. |
| GET /{resource}/{id} | Typed record |
| POST /{resource} | `{value: Record}`. Client-supplied UUID, revision 0. Server returns revision 1. |
| PUT /{resource}/{id} | `{expectedRevision: number, value: Record}`. Server increments revision. |
| POST /weeks/{id}/copy | `{startDate: "YYYY-MM-DD"}`. Returns new Week. Clone prescriptions, use current saved default targets, never copy sessions. |
| POST /workouts/{id}/start | Legacy convenience action: `{performedOn: "YYYY-MM-DD"}`. Returns snapshot Session with running clock, no inferred actual values. The web client instead creates an idle session via POST /sessions when the first recording action occurs. |
| GET /history | `exerciseId`, optional `routineId`, `before` date. Returns Previous or null. Matches the current exercise identity or a verified exact history alias. |
| GET /ledger | `weekId`. Returns Ledger. |
| GET /changes | Change[] newest first |
| GET /keys | ApiKeyInfo[] |
| POST /keys | `{name, scopes}` returns `{key, info: ApiKeyInfo}`. User sessions only. |
| DELETE /keys/{id} | User sessions only. Returns `{ok:true}`. |
| GET /export | ImportManifest compatible owner export. `format=csv` exports actual results. |
| POST /import | `{manifest: ImportManifest}`. User sessions only, additive and idempotent, conflicts never overwrite. |

Every mutation requires an `Idempotency-Key` header. Same owner + key + request returns original response. Reusing key with different request is 409. Revision conflict is 409 with current resource in `error.details.current`. Creation never overwrites an existing ID. All foreign IDs must belong to the actor. Cookie writes require allowed Origin. API key scopes are read, plans:write, results:write and library:write.

## Persistence And Counting

Persist equipment, exercises, exercise-muscle relations, weeks, workouts, sessions, result sets, audit events and idempotency receipts in PostgreSQL using Drizzle. Typed block snapshots may use JSONB. Actual sets must also be relational records, not only opaque notes. Authentication tables are managed through Better Auth. Bootstrap owner outside public HTTP registration.

Set credit: only completed results tied to a working target in an item with role `lifting` and non-null primaryMuscle count. Both sides of a unilateral set are one target, not two credits. Do not infer results from completing a session. Plan edits do not mutate session snapshots. Partial/approximate historical facts retain source notes.

New sessions use `loggingMode: "automatic"` and snapshot each item's `trackingFields`. Actual values are never copied from targets. On save, the API infers completion from required fields, preserves explicit skips and rejects finishing with unresolved sets. Legacy explicit sessions preserve historical statuses. Optional `userNotes` are separate from imported `notes`.

Manifest version 1 accepts optional `trainingDefaults` and `timerSettings` for compatible export and additive restore. Conflicting existing defaults or timer settings are not overwritten. CSV preserves source Notes and exposes User Notes and workout-level equivalents separately.

Exercises accept optional `historyAliases` (up to 100 strict `{exerciseId, equipment, setup}` tuples). Matching uses the entire tuple and never follows aliases transitively. Referenced exercise IDs must belong to the owner, except a self-reference during creation. Aliases are private historical metadata, preserved in owner exports and additive imports. Imports create exercise identities before validating alias references, supporting forward and cyclic references inside the same transaction. Existing session snapshots and ledger assignments remain unchanged.

Workout duration uses `startedAt`, `finishedAt`, optional `timerPausedAt` and optional `pausedDurationMs`. Missing pause fields mean running with zero accumulated pause time. Compare timestamps as instants, not strings. A missing historical start or completed finish means unknown duration. Elapsed time ends at finish, the current pause, or now, then subtracts accumulated pause time. Resuming or finishing folds the ongoing pause into `pausedDurationMs` and clears `timerPausedAt`. Reset clears start, finish and pause state, returning the clock to an idle 0:00 without changing results. Manual timestamp edits clear pauses. Pause timestamps require an active session with a start and no finish. Pause duration cannot exceed the known start-to-pause or start-to-finish interval. These fields persist in session JSON and compatible backups without a database migration.

Rest countdown state is client-side, owner-scoped and tab-local, with absolute deadlines rather than decrementing counters. Rest timer preferences persist through the API, but the countdown itself does not.

The timer-settings API retains `keepScreenAwake` for compatibility. The current web client does not use it to control wake locks. Display preference uses local storage key `training-display:v1:{ownerId}` with `{version: 1, keepScreenAwake: boolean}`, defaulting to true. It is device-local, separate from exports and server settings. The visible signed-in app owns one wake-lock lifecycle independently of rest timers.

## UI Integration

Use only `lib/api-client.ts` and `lib/offline.ts` for platform operations. No server imports or direct fetch to workout endpoints from components. Better Auth sign-in uses `/api/auth/sign-in/email` through a client helper. No public signup UI. The API is independent of the screen.

Web client methods are defined in `lib/api-client.ts`. Read that module for the current operation names and input types.

Save methods accept a full Record and decide POST vs PUT from `revision === 0`. They return the updated Record. `previous(exerciseId, routineId, before)` returns PreviousRecord.

Offline session functions: `cacheSession(ownerId, session)`, `readCachedSession(ownerId, id)`, `listCachedSessions(ownerId)`, `queueSession(ownerId, session)`, `flushQueue(ownerId)`, `listPending(ownerId)`, `resolveConflict(ownerId, id, choice)` and `clearOwnerCache(ownerId)`. Flush result reports conflicts and authentication failure. Queue stores latest whole-session draft against the last server revision. User resolves current-vs-local conflicts, never silent overwrite.
