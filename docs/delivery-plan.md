# Release Checklist

## Repository Boundary

Publish the tracker application only. Personal training documents, reviewed import manifests, database dumps, environment files, deployment links and local archives stay outside the published source tree. Tests must run with synthetic fixtures on a fresh checkout. No GitHub remote or public repository is required for a Vercel CLI deployment.

## Local Validation

1. Use Node 24 and `npm ci`. Start an isolated PostgreSQL 17 database and apply the committed migrations.
2. Generate API types with `npm run api:generate`. Review unexpected contract changes.
3. Run `npm run lint`, `npm run typecheck` and `RUN_DATABASE_TESTS=1 npm test`.
4. Build with `npm run build`. Start that build and run `npm run test:e2e` against the same database and origin.
5. Inspect mobile workout logging, both clocks, sheet gestures, navigation and page-specific loading states. Respect reduced motion.
6. Check tracked files and Git history for secrets and personal data before committing. Never force-add ignored data.

GitHub Actions performs the automated checks against disposable PostgreSQL. It has no production credentials and does not deploy.

## Production Release

Verify the linked team, project, production origin, database host and exact commit. Inspect current deployment and retain its URL for rollback. Run migrations only when a reviewed schema change requires them, with a private backup first.

```sh
vercel deploy --prod --skip-domain
```

Inspect the staged build before assigning the production domain. For a real integration check, `scripts/verify-cloud.ts` requires explicit deployment configuration and authorization for disposable test writes:

| Input | Purpose |
|---|---|
| `VERIFY_ENV_FILE` | Ignored file with the deployed database URL and canonical Better Auth URL |
| `VERIFY_OWNER_ENV_FILE` | Ignored existing-owner login file, defaults to `.env.local` |
| `VERIFY_PROJECT` | Expected project slug |
| `VERIFY_TEAM` | Expected Vercel team slug |
| `VERIFY_DATABASE_HOST` | Independently checked production database hostname |

Run `npx tsx scripts/verify-cloud.ts <deployment-url> --allow-test-writes --timers`. The check reads the real owner's data, creates a separate disposable account, verifies logging and timer persistence, compares the owner's export before and after, then removes only its test records. It never seeds workouts into the owner's account. Do not print environment values or upload authentication traces.

After the staged check passes, promote the exact tested production deployment with `vercel promote <deployment-url>`. Confirm the canonical URL, authentication, saved data and runtime error logs. On a release regression, roll back to the previously inspected deployment. Do not roll back the database without a separate recovery decision.

## Dependency Review

Run `npm audit` before release. Do not apply forced major downgrades to silence findings.

The October 21, 2026 audit reports 13 findings across development-tool chains: nine high findings from Next's ESLint plugin and shadcn tooling through `braces`, and four moderate findings from Drizzle Kit through an older `esbuild`. The former involves untrusted deeply nested glob patterns. The latter involves the esbuild development server. These tools are not application request handlers and are not exposed as development servers in production. The audit offers incompatible downgrades rather than compatible fixes. Restrict development tools to trusted input and review upstream fixes before the next dependency update. This is a documented outstanding risk, not a clean security audit. Keep shadcn as a build dependency because the application imports its Tailwind utilities.

## Catalog Changes

Review every affected identity before a catalog release. Obtain confirmation when an old name cannot establish the performed movement. Keep unverified model fields unknown. Preserve IDs, loads, session snapshots and historical ledger assignments.

For equipment/setup corrections, retain verified exact history aliases and test owned references, additive restore and previous-performance lookup. Rehearse against an isolated database using a private export. Compare protected snapshots and ledger totals before and after. Deploy compatible schemas before writing new optional fields to hosted records. Retain a private pre-change export and require revision checks for the live update.

Public examples must be generated independently from synthetic definitions, without private IDs, historical aliases, source excerpts or reported loads. Validate the sample through the actual Profile import UI and verify its ledger. Audit tracked files and Git history separately. Public source publication and connecting Git deployment are distinct release actions.

## Release Evidence

Keep deployment-specific evidence and private diagnostics in ignored `.local/` files. Record the source commit, test totals, staged and canonical checks, database migration status, and remaining limitations in the handoff. Avoid embedding personal workout histories in release documentation.
