# Contributing

## Scope

Keep the platform headless and the mobile client focused. Discuss new capabilities before introducing a new framework, provider or parallel data model. The [product requirements](docs/product-requirements.md) and [architecture](docs/technical-design.md) describe current boundaries.

## Development

Use the [local setup](README.md#quick-start). Make changes against a disposable local database, never production. Tests use synthetic fixtures. Personal training files and reviewed private imports are optional and must not be required to build or test.

## Contracts And Tests

Change runtime schemas, domain validation, client callers and regression tests together. Regenerate OpenAPI and TypeScript declarations with `npm run api:generate`. Preserve backward compatibility for old backups and session snapshots.

Before submitting changes:

```sh
npm run api:generate
npm run lint
npm run typecheck
RUN_DATABASE_TESTS=1 npm test
npm run build
npm run test:e2e
```

Browser tests require a running local server and migrated database. Explain which checks ran, what they covered and what remains unverified. Include real database or HTTP tests when changing persistence, ownership or imports. Mocked tests alone do not establish those boundaries.

## Data And Security

Never commit credentials, personal workouts, database dumps, browser authentication state or private exports. Do not force-add ignored files. Use freshly written examples and synthetic results in tests. Follow [Security](SECURITY.md) when reporting vulnerabilities.

Catalog changes need evidence for machine identity and confirmation for ambiguous performed movements. Keep brand, model and setup separate. Never change completed results to match a new library definition.

## Review

Describe the user-facing outcome, affected contracts and verification. Keep unrelated formatting changes out of functional changes. Include mobile screenshots for interface changes, using synthetic data and no authentication details.

Contributions use the project's [MIT license](LICENSE). Third-party dependencies retain their own licenses. Do not contribute material you cannot license.
