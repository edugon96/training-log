# Technical Design

## Architecture

```text
React Web Client         Future Mobile Client / Agent
        │                              │
        └──────── Versioned HTTP API ──┘
                         │
                Domain And Access Rules
                         │
               PostgreSQL + Drizzle
```

The first deployment uses Next.js for the web shell and route handlers. Domain modules live under `server/`, independently of React. The client consumes the generated API contract through `lib/api-client.ts`. Additional clients can use the same HTTP API without importing UI code.

The UI starts from the [official shadcn/ui Next.js template](https://ui.shadcn.com/docs/installation/next). This keeps the initial interface conventional and editable while avoiding a custom component framework.

## Data Model

The canonical validation schemas are in [contracts/models.ts](../contracts/models.ts). The detailed operation contract is in [contracts.md](contracts.md).

| Entity | Responsibility |
|---|---|
| Equipment | Machine identity, starting resistance and notes |
| Training defaults | Owner-scoped reusable muscle targets with revision checks |
| Exercise | Exact movement/setup identity and muscle mapping |
| Week | Start date, title and muscle targets |
| Workout | Reusable routine or dated prescription |
| Block | Ordered straight set, superset or circuit |
| Item | Exercise snapshot and independent target sets |
| Session | Performed-workout snapshot |
| Result | Individual actual set, status and source evidence |
| Audit event | Actor, operation and revision |
| Receipt | Idempotent mutation response |

PostgreSQL stores owner-scoped resources and relational actual-set rows. Ordered block snapshots use typed JSONB. Historical exercise labels and assignments remain in the session snapshot rather than being resolved from the current library.

Loads retain value, unit and basis. Added plates and machine starting resistance remain separate. A blank value represents unknown, never zero.

Equipment adds structured brand and type fields. The catalog endpoint supplies standard muscle, pattern and equipment-type choices plus brand/model suggestions from the owner's library. Compatibility enrichment preserves existing equipment IDs and historical labels.

Exercises and workout items may define `trackingFields`. Starting a new session resolves and snapshots them and sets `loggingMode: "automatic"`. Shared domain logic infers set completion from those fields on the client and server. Skipped status takes precedence, and completing a session with unresolved target sets is rejected. Legacy sessions without automatic mode retain recorded completion. Automatic sessions cannot downgrade their logging mode.

Optional `userNotes` keep newly written personal notes separate from imported commentary. Raw source notes remain available in exports. Presentation helpers suppress source metadata without rewriting stored records.

## API

The API lives under `/api/v1`. [public/openapi.json](../public/openapi.json) is generated from the shared schemas, and [contracts/api.d.ts](../contracts/api.d.ts) is generated from OpenAPI. The web client uses `openapi-fetch` plus runtime response validation.

Mutations require an `Idempotency-Key`. Updates include the expected revision. A stale revision returns HTTP 409 and the current record. Reusing an idempotency key with a different request also returns 409. Resource identifiers referenced in a request must belong to the current owner.

Full-record updates are deliberate for this prototype. They simplify offline snapshots and conflict detection. The tradeoff is coarse-grained conflicts when two clients edit different fields in the same session.

## Authentication And Authorization

[Better Auth](https://better-auth.com/docs/introduction) owns password hashing and sessions. Public registration is disabled. A local bootstrap script provisions the owner through the library's server API.

Browser writes validate origin. API keys are named, hashed by the authentication library and scoped. Key management and imports require an authenticated browser session. API responses containing owner data are not cached by the service worker.

No database credentials or API keys are embedded in the browser bundle. Local secrets live in ignored files with restricted permissions.

## Offline Synchronization

Dexie stores opened sessions and pending writes in IndexedDB, partitioned by owner. Each outgoing request has a persisted request snapshot and retry key. A failed connection retries that exact request. Edits made during an upload remain as a newer draft.

After a successful save, newer drafts receive the returned server revision and stay queued. HTTP 409 stops automatic replacement. The user explicitly keeps local work or adopts the latest server record. Cache clearing is blocked while pending writes exist.

A service worker caches the public application shell and static assets. It never caches private API responses. Offline authentication is device-local continuity for an already opened session, not authorization to write to the server.

## History And Ledger

History selects completed reported results before the requested date, matching exercise/setup identity. Routine matches take priority over other routines. Missing or uncertain actuals remain notes.

Verified library corrections can retain exact legacy identity tuples in optional exercise `historyAliases`. Matching never follows aliases transitively or guesses equivalence from a display name. Alias references are owner-validated and imports restore them after all exercise identities exist. Historical session snapshots, results and muscle assignments stay unchanged.

The ledger credits completed working targets on lifting items with a primary muscle. Unilateral work is credited once per prescribed set. Session completion alone does not add credit. The web client displays editable targets separately from totals.

Training defaults have a separate revision. Saving defaults does not mutate week snapshots. Copying a week uses the current defaults rather than inheriting its source week's override. Until defaults are saved, the read endpoint resolves the latest week's allocation, then falls back to the initial allocation, without writing on GET.

## Import And Export

The import builder reads the original Fitness records and a reviewed actual-results manifest. Stable source keys generate deterministic IDs. Source file hashes and excerpts preserve provenance.

Import is additive and idempotent. Existing conflicting data is not overwritten. JSON exports use the same manifest envelope. CSV is a reporting format for actuals, not the canonical restore format.

## Local Runtime And Hosting

Node 24, PostgreSQL 17 through Docker Compose, and one Next.js process form the local runtime. PostgreSQL binds only to loopback.

Vercel hosts the deployed app with managed Neon PostgreSQL. Production and local Docker data remain separate. Production secrets are server-only and are excluded from preview environments. Releases stage a production build, verify it, then promote the same build. Local database files cannot be deployed as Vercel storage.

## Validation

Unit tests exercise domain rules and offline races. Real PostgreSQL and HTTP checks exercise authentication, ownership, scopes, revisions, imports and actual persistence. Browser tests cover plan editing, logging and mobile layout. Production build checks catch server/client boundary issues.
