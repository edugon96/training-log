# Training Log

An API-first, self-hosted training platform with a mobile-friendly workout log. Build weeks, organize straight sets and supersets, log actual performance, and compare training against a reusable muscle ledger.

The headless API is the foundation. The included React web app is one client. Agents, scripts and future apps can use the same versioned contracts, ownership rules and history.

## Capabilities

- **Structured training:** reusable routines, dated workouts, supersets, circuits and independent set prescriptions.
- **Practical logging:** previous performance beside actuals, automatic set completion, optional notes and explicit skipping.
- **Muscle ledger:** separate goals, planned sets and completed sets. Training defaults carry forward without changing old weeks.
- **Gym tools:** a manually started workout clock, pauses, rest presets and a custom countdown. Install the web app on your home screen.
- **Agent access:** scoped keys, generated OpenAPI, revision checks, idempotent mutations and attributed changes.
- **Portable data:** JSON backup and additive import, CSV results, and offline session logging on previously opened workouts.

## Quick Start

Requires Node 24, Docker Desktop and npm.

```sh
npm ci
npm run setup:local
npm run db:up
npm run db:migrate
npm run owner:bootstrap
npm run dev -- --hostname 127.0.0.1
```

Open `http://localhost:3000`. Your generated local login is in `.local/login.txt`. Credentials and local data stay outside Git. Setup preserves an existing environment.

Start with an empty library or import the [Hybrid Hypertrophy example](examples/hybrid-hypertrophy.json) through Profile. It supplies a curated library, reusable goals and an illustrative week with no recorded results. The [training model](docs/training-model.md) explains the 111-set allocation and how to adapt it. Repeat its sample week onto your chosen Monday.

See [Self-Hosting](docs/self-hosting.md) for persistent storage and deployment. Public registration is disabled. This is a privately provisioned, single-owner application, not a public fitness service.

## Guides

| Guide | Purpose |
|---|---|
| [User Guide](docs/user-guide.md) | Planning, logging, timers and offline behavior |
| [Training Model](docs/training-model.md) | Goals, set counting, exercise identity and the starter profile |
| [Agent Integration](docs/agent-integration.md) | Read, plan and write safely through the API |
| [Architecture](docs/technical-design.md) | Contracts, persistence, authentication and synchronization |
| [Self-Hosting](docs/self-hosting.md) | Local setup, Vercel, databases and backups |

## Project Status

Early working prototype. The web client uses Next.js, React, shadcn/ui and Golos Text. PostgreSQL, Drizzle and Better Auth provide persistence and access control. Automated domain, database, HTTP and browser tests cover the application, but it has not received an independent security audit.

Native clients, public signup, social features, wearable integrations and multi-stage interval timers are outside the current scope. Agents connect using your own tooling. No model provider or built-in autonomous coach is required.

Dependency findings and release gates are tracked in the [release checklist](docs/delivery-plan.md). Read [Security](SECURITY.md) before exposing an installation. Development uses a separate database from your hosted installation.

Contributions follow [Contributing](CONTRIBUTING.md). Source code is licensed under [MIT](LICENSE). The example contains synthetic prescriptions only. Personal workouts, credentials and private source records are not part of the distribution.
