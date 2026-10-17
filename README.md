# NestJS Starter Server

A generalized NestJS backend starter — Prisma ORM on PostgreSQL (via the `pg` driver adapter) with the cross-cutting pieces every project needs already built, documented, and wired together. Start a new project by copying this, renaming it, and adding your own domain modules next to the existing ones.

## What's included

| Concern | Where | Doc |
| --- | --- | --- |
| **Error handling** — one global filter, one response envelope, stable `errorCode`s, Prisma error mapping | `src/common/errors/`, `src/common/interceptors/` | [error-handling.md](./docs/concepts/error-handling.md) |
| **Authentication** — JWT access/refresh tokens, refresh cookie, Google sign-in, role guard, account-status gate | `src/modules/auth/` | [auth.md](./docs/auth.md) |
| **Users** — registration, email OTP verification, profile + avatar, password change/reset, roles, soft deactivation, admin stats | `src/modules/user/` | [user.md](./docs/user.md) |
| **OTP + Mail** — hashed one-time codes with cooldowns, Handlebars SMTP email | `src/modules/otp/`, `src/modules/mail/` | [otp.md](./docs/otp.md), [mail.md](./docs/mail.md) |
| **Blog** — CRUD, slugs, publish lifecycle, image upload, public/admin views | `src/modules/blog/` | [blog.md](./docs/blog.md) |
| **Audit log** — automatic change history via a Prisma client extension | `src/modules/audit-log/`, `src/prisma/extensions/` | [audit-log.md](./docs/audit-log.md) |
| **Pagination** — offset + cursor, search, Swagger schema, one call per repository | `src/shared/pagination/` | [pagination-concepts.md](./docs/concepts/pagination-concepts.md) |
| **File handling** — pluggable storage interface, local disk implementation, served from `/uploads` | `src/shared/storage/` | — |
| **Logging** — Winston, daily rotation, request correlation IDs, redaction | `src/shared/logger/`, `src/common/middleware/` | [logger.md](./docs/concepts/logger.md) |
| **Rate limiting** — global tiers + per-route limits for auth/OTP endpoints | `src/common/throttler/` | [rate-limiting.md](./docs/concepts/rate-limiting.md) |
| **Health checks** — liveness/readiness probes (DB, memory, disk) | `src/health/` | [health-check.md](./docs/concepts/health-check.md) |
| **Config** — per-module Zod-validated env, fail-fast at boot | `src/config/`, `*/config/*.env.ts` | [ENV_FILE.md](./docs/ENV_FILE.md) |
| **Database** — multi-file Prisma schema, base repository with transactions, seed script | `prisma/`, `src/prisma/` | [prisma-architecture.md](./docs/architecture/prisma-architecture.md), [prisma-concepts.md](./docs/concepts/prisma-concepts.md), [db-seed.md](./docs/db-seed.md) |
| **Validation helpers** — cross-field/date validators, multipart-form transforms | `src/common/decorators/`, `src/common/utils/` | — |

Swagger UI is served at `/api-doc`; the API lives under `API_PREFIX` (default `/api/v1`); health probes at `/health`, `/health/live`, `/health/ready`.

## Quick start

Requires Node.js 20 (see `.nvmrc`), Yarn 1, and PostgreSQL 13+.

```bash
yarn install
cp .env.example .env.development     # then fill in DATABASE_URL, JWT secrets, SMTP, SEED_* passwords
yarn generate                        # generate the Prisma client
yarn db:deploy                       # apply migrations
yarn db:seed                         # create the baseline accounts (edit prisma/seed.ts first)
yarn start:dev                       # http://localhost:<PORT>/api-doc
```

### Starting a new project from this template

1. Rename the package in `package.json` and set `APP_NAME` in your env files.
2. Replace the placeholder accounts in `prisma/seed.ts`.
3. Adjust `UserRole` in `prisma/schema/user.prisma` if you need more roles.
4. Restyle `src/modules/mail/templates/otp.hbs`.
5. Delete the blog module if you don't need it: `src/modules/blog/`, `prisma/schema/blog.prisma`, its entry in `app.module.ts` and in `TRACKED_AUDIT_MODELS`, and `docs/blog.md`. Then create a migration.
6. Add your own modules under `src/modules/<domain>/` following the blog/user layout (controller → service → repository extending `BaseRepository`, DTOs, a `<domain>.prisma` schema file).

## Scripts

Every env-aware script loads exactly one env file with `dotenv-cli`, so **the script suffix decides which database you hit**. Nothing is inherited or merged between files. See [ENV_FILE.md](./docs/ENV_FILE.md) for every variable.

| What it does | `.env.development` | `.env.development.local` | `.env.office` | `.env.production` |
| --- | --- | --- | --- | --- |
| **Run the server** (watch mode) | `start:dev` | `start:local` | `start:office` | `start:prod` |
| **Prisma generate** | `generate` | `generate:local` | `generate:office` | `generate:prod` |
| **Create a migration** | `db:migrate` | `db:migrate:local` | — *(never)* | — *(never)* |
| **Apply migrations** | `db:deploy` | `db:deploy:local` | `db:deploy:office` | `db:deploy:prod` |
| **Prisma Studio** | `studio` | `studio:local` | `studio:office` | `studio:prod` |
| **Seed baseline accounts** | `db:seed` | `db:seed:local` | `db:seed:office` | `db:seed:prod` |

Environment-independent scripts:

| Command | Purpose |
| --- | --- |
| `yarn build` | Compile TypeScript to `dist/` |
| `yarn start` | **Production start** — runs `node dist/main`. Requires `yarn build` first. |
| `yarn start:debug` | `nest start --debug --watch` — reads the ambient environment, not an env file |
| `yarn lint` | ESLint with `--fix` |
| `yarn format` | Prettier over `src/` and `test/` |
| `yarn test` | Jest unit tests (`test:watch`, `test:cov`, `test:debug`, `test:e2e` also exist) |

> **`yarn start` runs the compiled build** and does not compile anything — always `yarn build` first. `start:prod` runs `nest start --watch`; it is for verifying production config locally, not for serving live traffic.

## Migrations

`prisma/migrations/` starts with a single baseline, `20261017000000_init`, which creates every table plus two things Prisma's schema DSL can't express: the `pg_trgm` extension (for the profile-name search indexes) and the partial unique index on `users.email WHERE deleted_at IS NULL`.

`prisma migrate deploy` only applies migration folders that already exist. It never creates one and never resets the database. So the order is always: author on dev → commit the generated folder → deploy outward.

```bash
yarn db:migrate --name your_migration_name   # 1. author against .env.development
git add prisma/migrations && git commit       # 2. commit the generated folder
yarn db:deploy:office                         # 3. roll out to staging
yarn db:deploy:prod                           # 4. then to production
```

> **Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` against a shared or production database** — each can drop or rewrite data. That is why no `:office` / `:prod` variants of those commands exist.

Need a one-off Prisma command that has no script? Invoke `dotenv-cli` **by path**, exactly as `package.json` does:

```bash
node node_modules/dotenv-cli/cli.js -e .env.production -- npx prisma migrate status
```

> **⚠️ Do not use `yarn dotenv -e <file> -- <command>`.** Yarn v1 swallows the `--`, `dotenv-cli` then injects nothing, and [prisma.config.ts](./prisma.config.ts) falls back to `NODE_ENV=development` — so the command silently runs against `.env.development.local`, not the file you named. **Always read the `Datasource "db": …` line Prisma prints** — it is the only reliable statement of which database you just talked to.

### Bootstrapping a fresh database

1. **Start empty.** Dropping every table does *not* empty a PostgreSQL database — enum types survive, and the next deploy dies on its first `CREATE TYPE` (`42710`). Either drop and recreate the database (needs ownership or `CREATEDB`), or drop tables **and** enum types in `public`.
2. **Deploy and seed:**
   ```bash
   yarn generate:prod
   yarn db:deploy:prod
   yarn db:seed:prod
   ```
   `pg_trgm` is a trusted extension on PostgreSQL 13+, so the init migration can create it without a superuser.
3. **Verify:** `node node_modules/dotenv-cli/cli.js -e .env.production -- npx prisma migrate status` should report **"Database schema is up to date!"**.

#### Reading migration failures

`P3018` is Prisma's wrapper — the PostgreSQL code after it is the real diagnosis:

| Code | Means | Cause |
| --- | --- | --- |
| `42710` | `type "X" already exists` | Tables were dropped but enum types survived — wipe the schema, not just the tables |
| `42P07` | `relation "X" already exists` | The database was built from a different migration lineage, or a dump was restored over it |
| `42501` | `permission denied` | Usually `CREATE EXTENSION` on a PostgreSQL older than 13, or a role without `CREATE` on the database |

A failed migration is recorded with `finished_at = NULL` and **blocks every subsequent deploy** until resolved. On a database with no data worth keeping, bootstrap again. On one with real data, reconcile with `prisma migrate resolve` — never `migrate dev` or `migrate reset`.

## Project layout

```
src/
├── main.ts                 # bootstrap: validation pipe, exception filter, CORS, Swagger
├── app.module.ts           # module wiring, global interceptors, middleware
├── config/                 # app-level env schema + composed boot-time validation
├── common/                 # decorators, errors, interceptors, middleware, throttler, utils
├── shared/                 # hash, logger, pagination, storage (domain-agnostic services)
├── prisma/                 # PrismaService, BaseRepository, audit-log extension
├── health/                 # liveness/readiness probes
├── generated/prisma/       # generated client — never edit
└── modules/
    ├── auth/  user/  otp/  mail/      # identity
    ├── blog/                          # example content module
    └── audit-log/                     # change history read API
prisma/
├── schema/                 # multi-file schema (schema.prisma = generator + datasource only)
├── migrations/
└── seed.ts
docs/                       # module and concept documentation (see table above)
uploads/                    # local file storage (gitignored)
```

More: [folder structure notes](./docs/architecture/FOLDER_STRUCTURE_ARCHITECTURE.md), [pagination architecture](./docs/architecture/pagination-architecture.md).
