# User Guide

An API-first personal workout log. Plan a week, organize movements into groups, see previous performance, and record actual sets from a phone or browser.

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
2. Use New workout below the selected week’s rows, add a reusable routine, or repeat a previous week. New workouts and routines stay as device drafts until Save. Cancel discards an unsubmitted draft.
3. New workouts and routines start with Group 1. Use Add movements within a group to select several exercises and add them together in selection order. Each starts with one Normal set. Add group creates another empty section. The group menu holds Rename group, Edit instructions, Reorder groups and Remove group. Move to group in a movement’s menu moves it with its sets, notes, results and rest settings. Groups organize the workout without changing how sets are performed or counted. Empty groups remain until removed.
4. Open a workout directly. Viewing a plan does not create a performed session or start its clock.
5. Enter actuals, then check each finished set. Gray values are suggestions. Checking accepts the visible values. Unchecking retains them without completion credit. Editing a completed value requires another check. Tap the set number to change its type or remove it. Use the movement menu’s Set details for set notes, skipping, units or corrections. Add set copies the last prescription into a new Normal set.
6. Finish the workout. Review incomplete rows or explicitly skip the remaining rows.

Previous shows your latest comparable session before this workout's date, including another routine earlier in the week. New movements load history as soon as they are added. When a set has no prescribed value, gray suggestions can use that previous session's matching set type. Entered values and explicit prescriptions take priority. Known weight units convert for suggestions when you change entry units. Historical results remain unchanged, and missing recorded weights remain unknown. Machine movements include weight entry even without a saved default load, unless you explicitly choose other tracking fields.

Training goals are reusable defaults for new and repeated weeks, with explicit week overrides. The muscle ledger credits each eligible working set to one primary muscle. Power and conditioning remain separate.

Home shows completed workouts, logged training time and working sets above compact workout rows. Each row opens the same workout screen, ready for logging or read-only when completed. The workout menu holds Edit movements, Edit results and Save as routine. Structural changes update the plan until recording begins, then update the performed snapshot. Results autosave. Incomplete corrections to completed workouts stay on the device until resolved or explicitly skipped, leaving the saved completed record intact.

The week menu holds the muscle ledger and planning controls. Profile contains the editable display name, read-only email, reusable training goals and settings. Historical workouts remain accessible through their weeks without a separate History tab. Unknown historical durations remain unknown, and partial time coverage is labeled.

Workout creation, editing and logging use focused screens with sticky top controls. Secondary mobile menus and settings use bottom sheets. Existing workout edits autosave. Unfinished or failed edits stay on the device and return when reopening that editor. The exercise picker keeps selections across search and filter changes. Use Add N exercises to return. Movement units live in the movement menu and apply to new entries. Set-specific unit overrides remain available in the movement menu’s Set details. Changing a unit label does not convert a recorded weight.

Movement cards place Rest and Note controls below the name, followed by independent note rows and the set table. Creation notes belong to that workout. Editing them during training changes only the session copy. New training notes belong only to that session. Swipe a note or set left, then tap Delete. The note icon also exposes Delete Note. Remove whole movements from their menu. Group instructions remain above their movements, even when a group contains only one movement. Groups collapse independently. Adding movements preserves your position and collapsed groups. Historical round counts remain visible as planning information.

Tap the set number to choose Warm Up (W), Normal, Failure (F) or Drop (D). The help icon opens an explanation without changing the type. Visible numbering advances for Normal and Failure rows, while W and D replace the number. This display convention does not change ledger credits. Normal, Failure and Drop rows each count once toward eligible working-set goals. Warm-ups are excluded from those goals. Suggestions repeat the preceding entered set when its prescription matches, while changes in type, load, reps or other targets retain their prescribed values.

The workout summary shows duration, completed/planned sets, exercises and external-weight volume. Volume includes completed warm-ups, converts kilograms to pounds for display, and counts the entered weight once for per-hand or unilateral work. Recorded weights count even when the load basis is unspecified. Bodyweight, assistance, and sets missing a weight, weight unit or rep count are excluded. The information button explains coverage.

Use Workout actions → Delete workout to remove a workout and all its linked results. The confirmation shows its name, date and logged-set count. Deletion requires a connection and cannot be undone. Routines and other workouts stay unchanged. If new results arrive while the confirmation is open, review and confirm again. Removing an individual movement or set with entered results also requires confirmation. Removing a populated group confirms removal of its movements and results. Empty groups can be removed immediately.

The exercise library uses standard muscle and pattern choices. Equipment has separate name, type, brand, model and starting-resistance fields. Imported source notes remain in exports but stay out of the everyday workout view.

## Timers

The top toolbar holds Back, Clock and Finish. Clock combines Rest timer and Workout clock in one panel. Choose Workout clock and Start when ready. A running rest countdown appears in the Clock button. Opening or logging a workout never starts the clock automatically. Elapsed time includes rests and excludes explicit pauses. Reset returns the clock to an idle 0:00 without changing sets or the rest countdown. Pauses and resets autosave, work offline, and persist after reload. Finishing an untimed workout leaves its duration untracked.

The Workout clock tab shows editable Start time and End time fields. Completed workouts open directly on this tab and allow time corrections without entering Edit results. Changes save quietly when leaving a field or closing Clock. An end before the start shows an inline error and leaves the last valid times intact. Unknown historical times may stay blank. Time corrections preserve completion status and all logged results. Other timestamp corrections clear recorded pauses.

Entering an end time stops only the clock, leaving the workout open for logging. Resume, or clearing an active end time, continues from the saved duration and excludes the stopped interval. Finish still reviews unfinished sets and preserves an end time already entered. Edit results remains available through the workout menu for set corrections.

Rest presets start at 30, 60, 90, 120, 150 and 180 seconds. Tapping a preset starts or replaces the countdown immediately. Both clocks use a flat radial dial with centered numerals and icon controls. Reset returns to a stopped 0:00 and clears the rest preset highlight. Adding 30 seconds preserves paused/running state. Custom opens a draggable ruler with swipe inertia and keyboard controls. Adjusting it leaves an existing countdown running until Play applies the draft. Closing the panel or changing screens leaves the countdown running. Finishing its associated workout cancels it.

Automatic rest is optional and defaults off. Enable it through the movement’s Rest control with a rest duration. Each movement has its own rest setting. It starts after checking that movement’s set and waits until the end of its drop-set sequence.

Manage presets in Profile. Valid settings save automatically online. Cached presets and custom timers work offline. Each browser tab has one rest countdown, restored after reload, including its stopped/reset state. The installed Home Screen app also recovers an unexpired running or paused timer after a full relaunch. Rest countdowns do not sync across devices. Workout timing is part of the saved session and does sync, including corrections made offline. Normal autosave runs silently. A muted cloud icon appears for offline use or a save problem that needs attention. Tap it for details. Countdown marks change with the displayed seconds, with one mark per second for rests up to three minutes and wider intervals for longer timers.

Sound is optional and defaults on. The timer uses Sensory UI's Crisp sounds: a soft tick as the custom selector changes value, a start cue for presets, Start and Resume, tones at three, two and one seconds remaining, and a completion cue at zero. Fast scrolling limits the tick rate. Sounds play while the app is visible and remain available offline after loading. Use Profile → Timers → Test sound to preview the start/countdown sequence or reactivate audio on this device. Pausing, resetting or replacing the timer cancels its old sounds.

Enable phone notifications in Profile on each device. On iPhone, open the installed Home Screen app and allow notifications when prompted. Test notification checks delivery. When the app is locked or in the background, timer completion uses the phone's standard notification alert. Sound, Focus and notification settings remain controlled by iOS. A foreground notification stays silent when the countdown audio covers it or sound is turned off. If countdown audio is unavailable, the completion notification can still alert. Notification delivery needs connectivity. Offline timers continue locally.

Profile → Display → Keep screen awake defaults on while the signed-in app is visible, independently of timers. This preference is saved for the account on this device. Leaving the app or signing out releases the wake lock. Returning, restoring the page or interacting requests it again when needed. Browser support, manual locking and power-saving settings can still allow the phone to sleep. The workout toolbar stays at the top while the workout summary scrolls away. Vertical overscroll and pull-to-refresh are suppressed where supported.

## Offline Use

Open the app and workout online first. Workout edits are stored on the device immediately and save automatically when connected. Cached weeks and workouts stay accessible offline through Week. Back remains available while saving. The app merges edits automatically, preserving changes to different fields. If two devices change the same field, the last save accepted by the server wins.

The production build supports offline page reload through its service worker. Development mode does not register the worker by default. An already open development page can still queue session edits while disconnected.

Offline logging is for a trusted personal device. It does not encrypt IndexedDB at rest. Existing workout editors retain offline changes and retry valid plan edits when connected. New-week and library changes require a connection. Deletion always requires a connection.

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

Hevy informs the movement-card presentation and selected interactions. The tracker retains its weekly workout organization, routines, plan/session separation, muscle ledger, and counting rules. Reference matching does not redefine those flows.
