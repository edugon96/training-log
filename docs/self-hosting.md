# Self-Hosting

## Requirements

Use Node 24 and PostgreSQL 17. Local setup uses Docker Compose. Hosting needs persistent PostgreSQL and a Next.js-compatible Node runtime. The app provisions an owner privately and disables public signup.

## Local Setup

Follow the [Quick Start](../README.md#quick-start). `setup:local` generates secrets in ignored `.env.local` and writes a private login file. It preserves existing credentials. `owner:bootstrap` uses those credentials to provision the owner through Better Auth.

Docker's database volume survives container restarts. `docker compose stop` pauses the database. Do not remove the volume unless you intend to erase that local installation.

Import the [sample profile](../examples/hybrid-hypertrophy.json) through Profile, or build your own library. JSON import is additive and rejects conflicting records. It is not a replacement or synchronization operation.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Server-only PostgreSQL connection |
| `BETTER_AUTH_URL` | Canonical public origin, or local development origin |
| `BETTER_AUTH_SECRET` | Strong, randomly generated authentication secret |
| `OWNER_EMAIL` | Private owner bootstrap input |
| `OWNER_NAME` | Private owner bootstrap input |
| `OWNER_PASSWORD` | Strong owner bootstrap password |

Owner bootstrap inputs are provisioning credentials, not browser variables. Keep secrets out of Git and `NEXT_PUBLIC_*`. Preserve the authentication secret across ordinary releases. Use a separate origin, secret and database for development and previews.

## Vercel Deployment

The source repository may be public while the deployed app and database remain private. Repository visibility does not grant access to server environment variables or authenticated records.

1. Create or select a Vercel project for the tracker directory. Provision PostgreSQL near the function region.
2. Configure production-only server variables. Set the canonical authentication origin to the domain users will visit.
3. Back up existing data before a migration. Run committed migrations and private owner bootstrap against the explicitly selected database.
4. Build and verify locally, then deploy a staged production build. Follow the [release checklist](delivery-plan.md) to verify and promote that exact build.
5. Sign in through the canonical domain. Check persistence, history, timers and export before training.

When GitHub is connected to Vercel, changes to the configured production branch can trigger production deployments, and other branches can create previews. Connecting the repository is a separate administrative action. Do not attach production credentials to untrusted fork previews. Included CI validates code and does not deploy or need production secrets.

Database hosting and Vercel hosting are separate services. Check provider limits and pricing for your usage. A serverless deployment cannot use a local Docker volume as its database. Local and hosted data do not synchronize automatically.

## Backup And Recovery

Profile exports structured JSON and CSV actual results. Use JSON for additive restoration. CSV is a reporting format. Protect both as personal data.

`npx tsx scripts/backup-local.ts` backs up the local Docker database into ignored `.local/`. Use your provider's backup and recovery facilities for hosted PostgreSQL. Test restoration in an isolated database before depending on a backup.

Rolling back code does not roll back data. Before a release, record the prior deployment and any migration compatibility requirements. Never assume a code rollback recovers a database.

## Mobile And Offline

Open the hosted app on your phone and add it to the home screen. Sign in and open a workout online before offline logging. Browser storage contains personal data on that device and is not encrypted by the app. Rest alerts and wake locks remain subject to browser and operating-system limitations.
