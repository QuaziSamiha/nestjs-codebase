# Environment Variables

Every variable is validated at boot by a Zod schema — the app refuses to start on a missing required value or a malformed one. Each module owns the schema for its own variables, and `src/config/env.validation.ts` merges them into one fail-fast check.

Start from [`.env.example`](../.env.example): copy it to the env file(s) you need and fill in real values. Only `.env.example` is committed; every other `.env*` file is gitignored.

## Env files and how they load

| File | Loaded by | Typical use |
|---|---|---|
| `.env.development` | `yarn start:dev`, `yarn db:*` (no suffix) | Shared/default dev config |
| `.env.development.local` | `yarn start:local`, `yarn *:local` | Your personal local overrides |
| `.env.office` | `yarn start:office`, `yarn *:office` | An internal/staging server |
| `.env.production` | `yarn start:prod`, `yarn *:prod` | Production |

The app itself (`ConfigModule.forRoot` in `app.module.ts`) resolves, first match wins: `.env.<NODE_ENV>.local` → `.env.<NODE_ENV>` → `.env`. The npm scripts additionally pre-load one exact file via `dotenv-cli -e <file>`, which does **not** cascade — a secret a script needs must live in the exact file that script references.

## Reference

### Application — `src/config/env.validation.ts`

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` \| `production` \| `test`. `production` hides internal error details from responses. |
| `APP_NAME` | no | `My App` | Display name used in Swagger, the root endpoint and outgoing email. |
| `PORT` | no | `8000` | |
| `API_PREFIX` | no | `api/v1` | Global route prefix. Health routes are excluded from it. |
| `BASE_URL` | **yes** | — | Public URL of this API; prefixed onto stored upload paths in responses. Trailing slashes are stripped. |
| `HASH_SALT_ROUNDS` | no | `10` | bcrypt cost factor. |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_FROM` | no | — | SMTP settings for `MailModule`. Without them the app boots, but OTP emails fail (logged, not thrown). |

### Database — `src/prisma/config/database.env.ts`

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string. Also read by the Prisma CLI via `prisma.config.ts`. |
| `DATABASE_POOL_MAX` | no | `10` | `pg` pool size. |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | no | `10000` | |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | no | `0` | `0` = wait forever. |

### Auth — `src/modules/auth/config/auth.env.ts`

| Variable | Required | Default | Notes |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | **yes** | — | Generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. |
| `JWT_REFRESH_SECRET` | **yes** | — | Must differ from the access secret. |
| `JWT_ACCESS_EXPIRES_IN` | no | `5d` | Any `ms`-style duration. |
| `JWT_REFRESH_EXPIRES_IN` | no | `30d` | |
| `JWT_REFRESH_EXPIRES_IN_MS` | no | `2592000000` | Refresh-cookie max-age; keep in step with the line above. |
| `GOOGLE_CLIENT_ID` | no | — | Enables Google sign-in. Must match the frontend's client ID. Leave the line out entirely rather than empty — an empty string fails validation. |

### Logging — `src/shared/logger/config/logger.env.ts`

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `debug` in dev, `info` in prod | |
| `LOG_DIR` | `logs` | Rotated log files. |
| `LOG_MAX_SIZE` | `20m` | |
| `LOG_RETENTION_DAYS` | `14` | |
| `LOG_CONSOLE_ENABLED` / `LOG_FILE_ENABLED` / `LOG_ERROR_FILE_ENABLED` | `true` | |
| `LOG_JSON_CONSOLE` | off in dev | JSON console output for log shippers. |

### Health checks — `src/health/config/health.env.ts`

| Variable | Default |
|---|---|
| `HEALTH_MEMORY_HEAP_THRESHOLD_MB` | `500` |
| `HEALTH_DB_TIMEOUT_MS` | `5000` |
| `HEALTH_DISK_PATH` | current working directory |
| `HEALTH_DISK_THRESHOLD_PERCENT` | `0.9` |

### Rate limiting — `src/common/throttler/config/throttler.env.ts`

| Variable | Default | Notes |
|---|---|---|
| `THROTTLE_ENABLED` | `true` | Kill switch. |
| `THROTTLE_TRUST_PROXY_HOPS` | `0` | **Set explicitly in every deployed environment** — the number of reverse proxies in front of the app. See [rate-limiting.md](./concepts/rate-limiting.md). |
| `THROTTLE_SHORT_TTL_MS` / `THROTTLE_SHORT_LIMIT` | `10000` / `30` | Global burst tier. |
| `THROTTLE_LONG_TTL_MS` / `THROTTLE_LONG_LIMIT` | `60000` / `200` | Global sustained tier. |
| `THROTTLE_REDIS_URL` | — | Reserved for multi-instance deployments. **Redis storage is not wired yet** — setting it only logs a warning; counters stay in-memory. |

### Seeding — `prisma/seed.ts`

| Variable | Notes |
|---|---|
| `SEED_SUPER_ADMIN_PASSWORD` / `SEED_ADMIN_PASSWORD` / `SEED_USER_PASSWORD` | Required only when running `yarn db:seed*`. See [db-seed.md](./db-seed.md). |

## Comment convention

Comments in env files and source use the `//* UPPERCASE COMMENT` style (in `.env` files, prefix with `#` so dotenv parsers treat the line as a comment).
