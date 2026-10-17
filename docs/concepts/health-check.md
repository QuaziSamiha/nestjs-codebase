# Health Checks — Concepts, Features & Developer Guide

This document explains *what* `src/health` does, *why* it's built this way, and *how* to reuse it — as-is — in any future service. Unlike the feature modules under `src/modules/`, `src/health` is infrastructure, not domain logic: it has no knowledge of users, categories, or any business concept, which is exactly what makes it copy-paste portable.

---

## 1. Purpose

Kubernetes, Docker, ECS, and load balancers don't know whether an application is "working" — they only know what an HTTP endpoint tells them, polled on an interval. Without dedicated probe endpoints, an app cannot safely run in any orchestrated environment:

- A pod that's still booting gets traffic routed to it anyway (no readiness gate).
- A hung process never gets restarted (no liveness probe).
- A pod with a slow database gets killed and restarted instead of just pulled from rotation — causing a restart storm instead of a graceful recovery.

`src/health` exists to answer the two questions orchestrators actually ask, correctly separated, plus a general-purpose summary for human-facing monitoring.

---

## 2. Key concepts

### 2.1 Liveness vs. readiness — the distinction that matters most

| | `GET /health/live` | `GET /health/ready` |
|---|---|---|
| Question answered | "Is the process alive, not deadlocked?" | "Can this instance serve real traffic right now?" |
| Checks | Memory heap only — **no downstream calls** | Database connectivity + disk space |
| On failure | Orchestrator **kills and restarts** the container | Orchestrator/LB **pulls the pod from rotation**, no restart |
| Why the split exists | Must never depend on anything that can be transiently down, or a DB blip causes a restart storm | Depends on real dependencies on purpose — that's the point |

Conflating these two into one endpoint is the most common mistake in health-check implementations. `HealthController` (`health.controller.ts`) keeps them as separate methods (`live()`, `ready()`) precisely so neither can accidentally depend on the wrong things.

A third route, `GET /health`, runs everything (DB + memory + disk) together. It exists for monitoring dashboards and uptime checks — it is **not** wired to any orchestrator behavior, it's just a convenience summary.

### 2.2 Self-contained config — copy the whole folder, it validates itself

```
src/health/config/health.env.ts     // zod schema — HEALTH_* env vars
src/health/config/health.config.ts  // registerAs('health', ...) factory
```

Following the same pattern as `src/prisma/config/database.env.ts`, the env schema lives inside `src/health` itself and is merged into the app-wide schema in `src/config/env.validation.ts`:

```ts
const envSchema = appEnvSchema
  .merge(databaseEnvSchema)
  .merge(authEnvSchema)
  .merge(healthEnvSchema);
```

This means `src/health` has zero dependency on any other domain module's config. Drop the folder into a new project, add one `.merge(healthEnvSchema)` line to that project's root schema, and it validates its own env vars on boot — fail-fast, same as every other namespace in this app.

| Env var | Default | Used for |
|---|---|---|
| `HEALTH_MEMORY_HEAP_THRESHOLD_MB` | `500` | Heap ceiling for `live()` and the heap check in `check()` |
| `HEALTH_DB_TIMEOUT_MS` | `5000` | Hard upper bound on the DB ping (see §2.4) |
| `HEALTH_DISK_PATH` | `process.cwd()` | Path/drive the disk check measures free space on |
| `HEALTH_DISK_THRESHOLD_PERCENT` | `0.9` | Fails once disk usage exceeds this ratio (0–1) |

Thresholds are env-driven on purpose — a future service with a 256Mi container limit, or one that doesn't write to disk at all, just sets different env vars. No code change.

### 2.3 Indicators — built-in vs. custom

`HealthModule` imports `@nestjs/terminus`'s `TerminusModule`, which auto-provides `MemoryHealthIndicator` and `DiskHealthIndicator` — there is no reason to hand-roll either of those, so this codebase doesn't.

The only custom indicator is `DatabaseHealthIndicator` (`indicators/database.health.ts`), because Terminus has no generic SQL/Prisma indicator. It pings via `prisma.$queryRaw\`SELECT 1\`` using the existing global `PrismaService` — no extra DB module wiring required.

### 2.4 Why the DB check has its own timeout

`PrismaService` extends `PrismaClient` directly; a connection that's *hanging* (not refused) can otherwise block `$queryRaw` indefinitely, which would make the readiness check itself hang past what's useful. `DatabaseHealthIndicator.pingWithTimeout()` races the query against a `setTimeout` bound to `HEALTH_DB_TIMEOUT_MS`:

```ts
private pingWithTimeout(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Database ping exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );

    this.prisma.$queryRaw`SELECT 1`
      .then(() => resolve())
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}
```

The underlying query isn't cancelled (Prisma raw queries aren't abortable mid-flight) — it's just no longer awaited. That's harmless for a `SELECT 1`.

### 2.5 Error sanitization — the response and the log say different things

`/health/*` is **unauthenticated by design** (orchestrators don't send credentials), which means whatever the DB indicator returns on failure is public. `DatabaseHealthIndicator.isHealthy()` deliberately splits what gets logged from what gets returned:

```ts
} catch (e) {
  this.logger.error(
    'Database health check failed',
    e instanceof Error ? e.stack : e,
  );
  return this.getStatus(key, false, { message: 'Database unavailable' });
}
```

The full Prisma error — connection string details, host, port, driver-level messages — goes to the server log via `Logger`, never to the HTTP response. The client only ever sees the generic `"Database unavailable"`. This was verified by pointing `DATABASE_URL` at an unreachable host: the log captured the full `PrismaClientKnownRequestError` with stack trace, while the HTTP response body contained only the generic message and a `503`.

### 2.6 Routing — excluded from API prefix and versioning

`main.ts` excludes the health routes from the global prefix:

```ts
app.setGlobalPrefix(prefix, {
  exclude: ['health', 'health/live', 'health/ready'],
});
```

Orchestrator probe paths are configured once, outside this codebase (in a Helm chart, ECS task definition, etc.). If `health` were under `api/v1`, bumping the API to `api/v2` would silently break every configured probe. Keeping `/health*` unprefixed and unversioned means the probe configuration never has to change in lockstep with API versioning.

### 2.7 Throttling — defensively exempted

```ts
@SkipThrottle(SKIP_ALL_THROTTLERS)
@ApiTags('Health')
@Controller('health')
export class HealthController { ... }
```

Orchestrators and load balancers poll `/health/live` and `/health/ready` every few seconds by design (a typical container `HEALTHCHECK` hits readiness every 10–30 s). A global `ThrottlerGuard` **is** registered today (`AppThrottlerModule`, see [`rate-limiting.md`](./rate-limiting.md) §2.2), so without this exemption a probe would trip the 30-per-10s burst tier and a perfectly healthy container would be killed for the wrong reason.

**The argument is mandatory.** A bare `@SkipThrottle()` defaults to `{ default: true }` and exempts only a throttler *literally named* `default` — which is what an unnamed `forRoot` throttler gets. Under the named `short`/`long` tiers that is no tier at all, and this controller genuinely did start returning `429` under a 35-request burst before `SKIP_ALL_THROTTLERS` was passed explicitly. See [`rate-limiting.md`](./rate-limiting.md) §2.8.

---

## 3. Features & benefits

- **Correct orchestrator contract** — liveness and readiness are never conflated, so the right remediation (restart vs. pull-from-rotation) always happens.
- **Domain-agnostic and portable** — `src/health` knows nothing about users, blogs, or any other domain; the whole folder (controller, module, indicators, config) can be copied into any future project unchanged.
- **Self-validating config** — its env schema is independent and merges into the host app's `env.validation.ts` with one line, matching the same pattern as `src/prisma`.
- **No information disclosure** — failures are fully logged server-side but never leak connection details through the public, unauthenticated response.
- **Bounded by design** — the DB check can't hang past `HEALTH_DB_TIMEOUT_MS`, so a stalled (not just refused) dependency still produces a timely probe response.
- **Stable probe paths** — excluded from prefix/versioning, so they don't move when the API does.
- **Uses official building blocks** — `@nestjs/terminus`'s `MemoryHealthIndicator`/`DiskHealthIndicator` are reused as-is; only the Prisma-specific check is custom.

---

## 4. Use cases

| Scenario | Endpoint to configure | Why |
|---|---|---|
| Kubernetes `livenessProbe` | `GET /health/live` | Must only fail when the process itself is unresponsive — never on a dependency blip. |
| Kubernetes `readinessProbe` | `GET /health/ready` | Should fail whenever the pod genuinely can't serve a request (DB down, disk full), pulling it from the Service's endpoint list without killing it. |
| ALB/NLB target group health check | `GET /health/ready` | Same readiness semantics — target group should stop routing to an instance that can't reach its DB. |
| Uptime monitor / status page (e.g. UptimeRobot, Better Uptime) | `GET /health` | Human-facing summary combining DB + memory + disk in one call; not tied to any auto-remediation. |
| Smoke test after a deploy | `GET /health` | One call confirms every checked dependency, not just "process started". |

---

## 5. Developer guide — how to reuse or extend it

### 5.1 Dropping `src/health` into a new project

1. Copy `src/health/` (config, dto, indicators, controller, module) into the new project.
2. In that project's root env schema (its equivalent of `env.validation.ts`), import and merge `healthEnvSchema`, exactly as done here.
3. Register `HealthModule` in the root `AppModule`'s `imports` array.
4. In `main.ts`, add the same `exclude` list to `setGlobalPrefix` so probe paths stay unprefixed.
5. If `DatabaseHealthIndicator` references a `PrismaService` that doesn't exist in the target project (different ORM, different service name), that's the only file that needs adapting — everything else is ORM-agnostic.

### 5.2 Adding a new dependency check (e.g. Redis, S3, mail provider)

Follow the same shape as `DatabaseHealthIndicator`:

```ts
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return this.getStatus(key, true);
    } catch (e) {
      this.logger.error('Redis health check failed', e instanceof Error ? e.stack : e);
      return this.getStatus(key, false, { message: 'Redis unavailable' });
    }
  }
}
```

Then:
- Register it as a provider in `health.module.ts`.
- Add it to `ready()` (and `check()` if it should show up in the general summary) in `health.controller.ts` — **not** to `live()`, unless it's something that should kill and restart the pod when unreachable (it almost never should be).
- If it needs a tunable threshold/timeout, add the env var to `health.env.ts` and expose it via `health.config.ts`, following §2.2.

### 5.3 Testing the failure path locally

Point `DATABASE_URL` at an unreachable host/port for a single boot (don't edit `.env.*` files — pass it as an inline env override) and hit `/health/ready`:

```bash
DATABASE_URL="postgres://postgres:wrong@127.0.0.1:59999/nope" HEALTH_DB_TIMEOUT_MS=2000 \
  node node_modules/dotenv-cli/cli.js -e .env.development -- node dist/src/main.js
```

Expect `503` with `error.database.message === "Database unavailable"` in the response, and the full Prisma error in the server log.

---

## 6. Conventions & best practices

- **Never** add a dependency check to `live()`. Liveness must only ever check the process itself — adding a downstream call there reintroduces the restart-storm failure mode this design avoids (see §2.1).
- **Never** return a raw caught error (`e.message`) from an indicator's `isHealthy()`. Log the full error via `Logger`; return a generic, fixed string in the `getStatus()` data payload. These endpoints are unauthenticated by design (see §2.5).
- **Always** reuse a built-in Terminus indicator (`MemoryHealthIndicator`, `DiskHealthIndicator`, `HttpHealthIndicator`, etc.) before writing a custom one — only write a custom indicator when Terminus has no equivalent, as with Prisma.
- **Always** keep new thresholds/timeouts env-driven via `health.env.ts` / `health.config.ts` — never hardcode a magic number inline in the controller or an indicator, see §2.2.
- **Always** keep `/health*` excluded from the global API prefix and from auth — orchestrators don't version their probe config or send credentials.
- **Always** keep `@SkipThrottle(SKIP_ALL_THROTTLERS)` on `HealthController`, and never reduce it to the bare `@SkipThrottle()` — the bare form exempts nothing under this app's named tiers (see §2.7). Any new tier must be added to that constant too.
- `src/health` stays at the top level, alongside `config`/`prisma`/`common`/`shared` — **not** under `src/modules/`. It's infrastructure/ops tooling used by load balancers and orchestrators, not a business domain, and placing it under `modules/` would misrepresent its purpose to anyone navigating the codebase.
