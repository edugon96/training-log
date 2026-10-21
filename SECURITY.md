# Security

## Deployment Model

Training Log is an early, self-hosted application for a privately provisioned owner. Public signup is disabled. Owner-scoped storage is defense in depth, not a claim that a public multi-tenant service has been audited or supported.

Use HTTPS for hosted installations. Keep secrets server-only. Use separate databases and credentials for local development, previews and production. Give agents the minimum API scopes and revoke unused keys.

## Private Data

The repository must not contain personal workout history, exports, source manifests, database backups, environment files or authentication traces. Application source may be public without making hosted data public.

Offline logging stores personal data in browser IndexedDB without application-level encryption. Use trusted devices. API responses are not cached by the service worker. Rest alerts and screen wake behavior are constrained by device and browser.

## Reporting

Do not post secrets, personal records or exploit details in a public issue. If the repository enables GitHub private vulnerability reporting, use its Security tab. Otherwise request a private contact channel without sensitive details. This project has no guaranteed response time or supported-version policy yet.

## Release Checks

Review dependency findings, owner isolation, API scopes, origin validation, revision conflicts and backup behavior before release. See the [release checklist](docs/delivery-plan.md) for current dependency limitations. Passing tests is not an independent security audit.
