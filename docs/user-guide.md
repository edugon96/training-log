# User Guide

An API-first personal workout log. Plan a week, arrange supersets and circuits, see previous performance, and record actual sets from a phone or browser.

## Hosting

The app supports Vercel with a managed PostgreSQL database. Public signup is disabled. Local development uses a separate Docker database. The databases do not sync. Production credentials stay server-only and must not be assigned to preview deployments. See the [release checklist](delivery-plan.md) before deployment.

## Local Development

Requires Node 24 and Docker Desktop.

```sh
npm ci
npm run setup:local
npm run db:up
npm run db:migrate
npm run owner:bootstrap
npm run dev -- --hostname 127.0.0.1
```

Open `http://localhost:3000`. Local setup writes the private login to `.local/login.txt` and keeps secrets in `.env.local`. Both are ignored by Git. Setup preserves existing credentials. Public signup is disabled.

The PostgreSQL volume persists across restarts. `docker compose stop` pauses it without deleting data.

## Workouts

Name workouts by focus, such as Upper or Quad-Focused Lower. Keep dates and weekdays in the date field rather than repeating them in the name.

1. Home opens the current training week when available. Use the compact selector to switch weeks and the week menu to create or repeat one.
2. Add workouts directly, add a reusable routine, or repeat a previous week.
3. Arrange movements into straight sets, supersets or circuits. Each movement keeps its own set count.
4. Open a workout directly. Viewing a plan does not create a performed session or start its clock.
5. Enter actuals. Filled sets are completed automatically. Use the set menu for optional notes, skipping or corrections. Add sets below each movement when needed.
6. Finish the workout. Review incomplete rows or explicitly skip the remaining rows.

Training goals are reusable defaults for new and repeated weeks, with explicit week overrides. The muscle ledger credits each eligible working set to one primary muscle. Power and conditioning remain separate.

Home shows completed workouts, logged training time and working sets above compact workout cards. Each card opens the same workout screen, ready for logging or read-only when completed. The workout menu holds Edit movements, Edit results and Save as routine. Structural changes update the plan until recording begins, then update the performed snapshot. Results autosave. Incomplete corrections to completed workouts stay on the device until resolved or explicitly skipped, leaving the saved completed record intact.

The week menu holds the muscle ledger and planning controls. Profile contains the editable display name, read-only email, reusable training goals and settings. Historical workouts remain accessible through their weeks without a separate History tab. Unknown historical durations remain unknown, and partial time coverage is labeled.

Mobile dialogs, menus and pickers use bottom sheets that can be dragged down to close. Unsaved editor changes require confirmation before dismissal. Movement units live in the movement menu and apply to new entries. Set-specific unit overrides remain available in each row's menu. Changing a unit label does not convert a recorded weight.

The exercise library uses standard muscle and pattern choices. Equipment has separate name, type, brand, model and starting-resistance fields. Imported source notes remain in exports but stay out of the everyday workout view.

## Timers

The workout toolbar shows elapsed time and icon buttons for rest and finish. Tap elapsed time to open its clock controls and choose Start when ready. Opening or logging a workout never starts the clock automatically. Elapsed time includes rests and excludes explicit pauses. Reset returns the clock to an idle 0:00 without changing sets or the rest countdown. Pauses and resets autosave, work offline, and persist after reload. Finishing an untimed workout leaves its duration untracked.

Completed workouts remain completed while their results are corrected. Enter Edit results from the workout menu to change results or timestamps. Editing results alone preserves timing. Explicit timestamp corrections clear saved pauses.

Rest presets start at 30, 60, 90, 120, 150 and 180 seconds. Tapping a preset starts or replaces the countdown immediately. Both clocks use a flat radial dial with centered numerals and icon controls. Reset returns to a stopped 0:00 and clears the rest preset highlight. Adding 30 seconds preserves paused/running state. Custom opens a draggable ruler with swipe inertia and keyboard controls. Adjusting it leaves an existing countdown running until Play applies the draft. Closing the panel or changing screens leaves the countdown running. Finishing its associated workout cancels it.

Manage presets in Profile. Valid settings save automatically online. Cached presets and custom timers work offline. Each tab has one rest countdown, restored from owner-scoped session storage after reload, including its stopped/reset state. Rest countdowns do not sync across devices. Workout timing is part of the saved session and does sync. Workout timestamp corrections are available through the clock's overflow menu. Routine autosave success stays silent, while actionable errors and sync warnings remain visible.

Sound is optional and defaults on. A closed app or locked phone cannot guarantee a sound alert.

Profile → Display → Keep screen awake defaults on while the signed-in app is visible, independently of timers. This preference is saved for the account on this device. Leaving the app or signing out releases the wake lock. Returning requests it again. Browser support, manual locking and power-saving settings can still allow the phone to sleep. The header scrolls away normally. Vertical overscroll and pull-to-refresh are suppressed where supported.

## Offline Use

Open the app and workout online first. Session edits are stored locally before syncing. Cached weeks and workouts stay accessible offline through Week. Profile exposes pending saves and explicit conflict choices.

The production build supports offline page reload through its service worker. Development mode does not register the worker by default. An already open development page can still queue session edits while disconnected.

Offline logging is for a trusted personal device. It does not encrypt IndexedDB at rest. Plan and library changes require a connection.

## API

The versioned API is `/api/v1`. The generated [OpenAPI specification](../public/openapi.json), [TypeScript API declarations](../contracts/api.d.ts), and [operation contract](contracts.md) are the integration entry points.

Create a named key in Profile with only the necessary scopes:

| Scope | Access |
|---|---|
| `read` | Read owned plans, history, ledger and exports |
| `plans:write` | Create or update weeks, workouts, training defaults and timer settings |
| `results:write` | Start sessions and log or correct actual results |
| `library:write` | Maintain exercises and equipment |

Send `Authorization: Bearer <key>`. Every mutation requires a fresh `Idempotency-Key`. Retry the same request with the same key after an uncertain connection failure. Updates include `expectedRevision` and the full resource. A 409 response requires rereading or resolving the conflict.

Key management and imports require a browser login. No secrets belong in application source or browser environment variables.

## Historical Import And Backups

`npm run import:build` reads Fitness-format Markdown and a private reviewed source manifest, producing `data/import.json`. Set `FITNESS_SOURCE_ROOT` and `FITNESS_REVIEWED_MANIFEST` for another location. Defaults use the parent directory and `data/source-manifest.json`. This optional adapter requires a separately reviewed source manifest. It is not required to run the app or tests. The original records are read-only. Import the generated JSON in Profile.

Profile exports full JSON backups and CSV actual results. JSON imports are additive. A conflicting existing record is rejected rather than replaced.

For a local PostgreSQL backup before migrations, run `npx tsx scripts/backup-local.ts`. It stores a private custom-format archive under `.local/` using the running Docker database.

Personal source data and generated backups are intentionally excluded from Git. Preserve them separately when moving this project.

## Validation

```sh
npm run api:generate
npm run lint
npm run typecheck
npm test
RUN_DATABASE_TESTS=1 npm test
npm run test:e2e
npm run build
```

The HTTP/browser tests expect a local server and migrated database. They create isolated test users and clean up only those users' data. Import regression tests use synthetic checked-in fixtures. GitHub Actions runs against a disposable PostgreSQL service without production secrets.

## Repository Layout

| Directory | Contents |
|---|---|
| `app/` | Web entry points and API routes |
| `components/` | Tracker screens and shared UI primitives |
| `contracts/` | Runtime schemas and generated API types |
| `server/` | Authentication, domain rules and database access |
| `lib/` | Client API, offline storage, timers and presentation |
| `drizzle/` | Reviewed database migrations |
| `scripts/` | Setup, import, backup and verification tools |
| `tests/` | Unit, database and browser coverage with synthetic fixtures |
| `docs/` | Product, architecture, API and release guidance |

Personal data, local archives, environment files, authentication state and generated reports stay ignored. Do not force-add them. Application source is MIT licensed. Personal training data is not distributed.

## Design

The [product requirements](product-requirements.md) define capabilities and adoption criteria. The [technical design](technical-design.md) describes the data model, API and offline behavior. The [delivery plan](delivery-plan.md) identifies validation gates.

The web client uses Next.js, React and shadcn/ui. PostgreSQL, Drizzle and Better Auth provide persistence and access control. Vercel hosts the app and Neon Free hosts production data.
