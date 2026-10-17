# Logger — Concepts, Features & Developer Guide

This document explains *what* `src/shared/logger` does, *why* it's built this way, and *how* to use or extend it. Like `src/health`, it's infrastructure — it has no knowledge of users, categories, or any business concept — which is what makes it copy-paste portable into any future project.

---

## 1. Purpose

Before this module existed, the app only had NestJS's default console `Logger`: no persistence, no way to trace a single request across multiple log lines, no separation between routine noise and real incidents, and no protection against a stray `password` field ending up in a log file. A sibling project's Winston setup fixed persistence but not the rest.

`src/shared/logger` exists to make five things true simultaneously, with **zero changes required to any existing `Logger` call site in the app**:

1. Every log line can be traced back to the single HTTP request that produced it, even across unrelated services.
2. Log level, directory, rotation size, and retention are environment-driven, not hardcoded.
3. Errors land in their own file, separate from routine access noise, for fast incident triage.
4. Sensitive fields (passwords, tokens, cookies) never reach a log file in plaintext.
5. Every request produces exactly one access-log line (method, path, status, duration) without any controller or service having to log it manually.

---

## 2. Key concepts

### 2.1 Correlation tracing — `AsyncLocalStorage`, not a library

Tracing one request across `AuthController` → `MailService` → `GlobalExceptionFilter` requires the same `correlationId` to be readable from all three, without passing it as a parameter through every function signature in between. This module uses Node's built-in `AsyncLocalStorage`, not a dependency like `nestjs-cls` — the problem is well-understood and small enough (~40 lines) that pulling in a library adds a dependency for no real gain.

The flow, in order, for every request:

```
CorrelationIdMiddleware        →  reads/generates x-correlation-id, sets req.correlationId
        ↓
RequestContextMiddleware       →  opens the ALS scope: requestContextService.run({ correlationId }, next)
        ↓
LoggingInterceptor             →  backfills userId/role once guards have populated req.user
        ↓
(everything downstream — guards, controller, services, GlobalExceptionFilter —
 runs inside the same ALS scope and can read it)
        ↓
winston-logger.factory's contextEnrichmentFormat  →  reads RequestContextService.getStore()
                                                       and stamps correlationId/userId/role
                                                       onto every log line, automatically
```

`RequestContextMiddleware` **must** be registered after `CorrelationIdMiddleware` in `app.module.ts` — it reads `req.correlationId`, which only exists once the first middleware has run:

```ts
consumer
  .apply(CorrelationIdMiddleware, RequestContextMiddleware)
  .forRoutes({ path: '*path', method: RequestMethod.ALL });
```

Because the enrichment happens inside the winston format pipeline (`winston-logger.factory.ts`), any existing or future `this.logger.log('...')` call anywhere in the app automatically carries the current request's `correlationId` — no call site needs to know this module exists.

### 2.2 Self-contained env config

```
src/shared/logger/config/logger.env.ts     // zod schema — LOG_* env vars
src/shared/logger/config/logger.config.ts  // registerAs('logger', ...) factory
```

Same pattern as `src/health/config/health.env.ts` — the schema is merged into the app-wide schema in `src/config/env.validation.ts`:

```ts
const envSchema = appEnvSchema
  .merge(databaseEnvSchema)
  .merge(authEnvSchema)
  .merge(healthEnvSchema)
  .merge(loggerEnvSchema);
```

| Env var | Default | Used for |
|---|---|---|
| `LOG_LEVEL` | `debug` in dev, `info` in production | Minimum severity written to console and the application file |
| `LOG_DIR` | `logs` | Directory both rotating file transports write into |
| `LOG_MAX_SIZE` | `20m` | Size at which a file transport rotates early, even within the same day |
| `LOG_RETENTION_DAYS` | `14` | Passed to `winston-daily-rotate-file` as `maxFiles: '14d'` |
| `LOG_CONSOLE_ENABLED` | `true` | Toggles the console transport entirely |
| `LOG_FILE_ENABLED` | `true` | Toggles `application-%DATE%.log` |
| `LOG_ERROR_FILE_ENABLED` | `true` | Toggles `error-%DATE%.log` |
| `LOG_JSON_CONSOLE` | `false` in dev, `true` in production | Pretty/colorized single-line console in dev vs. JSON console in production (log-aggregator friendly if stdout is ever scraped) |

`logger.config.ts` resolves the dev/production defaults itself — callers never branch on `NODE_ENV`.

### 2.3 Three transports, one shared base format

```ts
const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  contextEnrichmentFormat(),   // §2.1
  redactionFormat(),           // §2.6
);
```

| Transport | File | Level | Purpose |
|---|---|---|---|
| Console | stdout | env-driven (`LOG_LEVEL`) | Real-time visibility; pretty in dev, JSON in production |
| `application-%DATE%.log` | `logs/` | env-driven (`LOG_LEVEL`) | Everything at or above the configured level — the day-to-day record |
| `error-%DATE%.log` | `logs/` | hardcoded `'error'` | Errors only, so an incident doesn't require grepping through routine access-log noise |

Both file transports rotate daily (`datePattern: 'YYYY-MM-DD'`), gzip old files (`zippedArchive: true`), and share the same `maxSize`/`maxFiles` config. The error transport's level is intentionally **not** env-configurable — its entire purpose is "errors only," so making that tunable would defeat the point.

### 2.4 Becoming Nest's app-wide logger

```ts
// main.ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
```

`app.useLogger()` is a first-class NestJS extension point built for exactly this — it rewires Nest's static `Logger` class, so every existing `new Logger(X.name)` call across the app (including `GlobalExceptionFilter`) becomes Winston-backed with **no code changes** to those files. `bufferLogs: true` holds framework bootstrap messages (route mapping, module init) until `useLogger()` attaches, so nothing bypasses the pipeline — without it, Nest's default console logger would print those messages before Winston takes over.

### 2.5 Access logging — `res.on('finish')`, not RxJS `finalize()`

`LoggingInterceptor` emits one line per request (method, path, status, duration, ip). The first implementation read `response.statusCode` inside RxJS's `finalize()` operator — and live testing caught it misreporting every 400/500 response as `200`. The reason: `finalize()`'s teardown callback fires as the error notification propagates through the interceptor's own `pipe()` chain, which runs **before** `GlobalExceptionFilter` (registered as a global filter outside the interceptor stack) actually calls `response.status(500).json(...)`. At the moment `finalize()` ran, Express's `response.statusCode` was still its unset default.

The fix — hook Express's own `finish` event, which only fires once the response has actually been sent:

```ts
response.on('finish', () => {
  // response.statusCode is now guaranteed to be the final value
});
return next.handle();
```

This is the same approach `morgan` and most HTTP access-log libraries use, and it was verified against a real 500: the same `correlationId` shows up correctly as `statusCode: 500` in the access line, in `MailService`'s own error log, and in `GlobalExceptionFilter`'s error+stack log — across both `application-*.log` and `error-*.log`.

Health-check probes (`/health`, `/health/live`, `/health/ready`) are logged at `verbose` instead of the default level, via a simple path-prefix check — not a route-exclusion list. Since `LOG_LEVEL` is `info` in production, `verbose` lines are silently dropped there, so orchestrator polling every few seconds never floods the log — while still showing up in local dev (`LOG_LEVEL=debug`) if you want to see them.

### 2.6 Redaction — and its current blind spot

`redactSensitiveFields()` (`utils/redact.util.ts`) deep-walks any logged object and replaces values for keys matching `DEFAULT_REDACTED_KEYS` (`password`, `token`, `refreshToken`, `otp`, `authorization`, `cookie`, `secret`, `apiKey`, ...) case-insensitively, at any nesting depth, with `'[REDACTED]'`. It runs as a winston format step, so it applies to metadata on *any* log call, not just HTTP bodies (which this module doesn't log at all, by design — see §6).

**Known gap:** the redaction walk treats any non-array `typeof value === 'object'` as a plain object to reconstruct via `Object.entries()`. Native `Error` instances have non-enumerable `message`/`stack`, so `Object.entries(anError)` returns `[]` — if a future call does `logger.error(anErrorInstance)`, nest-winston's adapter attaches that instance as a nested `error` meta field, and this redaction step silently collapses it to `{}`. The separate top-level `stack` string (extracted by `winston.format.errors()`) still survives, so you don't lose the trace entirely — but the `error` field itself becomes useless. If you add error-object logging anywhere, be aware of this before relying on that specific field; excluding `Error` instances from the recursive walk is the fix if you hit it.

---

## 3. Features & benefits

- **Zero call-site changes** — every existing and future `Logger` usage in the app gets correlation IDs, redaction, and file persistence for free, because the wiring happens once at bootstrap (`app.useLogger()`), not per call site.
- **One request, traceable everywhere** — `correlationId` threads through `AsyncLocalStorage`, so a single request is traceable across unrelated services and both log files with no manual plumbing.
- **Env-driven, not hardcoded** — level, directory, rotation size, retention, and console format all come from `LOG_*` vars, unlike the hardcoded baseline this was modeled on.
- **Fast incident triage** — a dedicated `error-*.log` means an on-call engineer doesn't grep through routine 200s to find what broke.
- **No accidental noise at scale** — health-check probes are demoted to `verbose`, so orchestrator polling doesn't drown out real traffic in production.
- **Redaction by default** — sensitive fields are stripped before they ever reach disk, without any per-call-site effort.
- **Self-contained and portable** — the whole `src/shared/logger` folder, plus one `.merge(loggerEnvSchema)` line, is the entire integration surface for a new project.

---

## 4. Use cases

| Scenario | What to do | Why |
|---|---|---|
| Trace a user-reported bug through the system | Ask for (or generate) the `x-correlation-id` from their request, `grep` it across `application-*.log` and `error-*.log` | Every log line touched by that request carries the same ID, regardless of which service emitted it |
| Production incident triage | Tail `error-*.log` only | Isolated from routine access-log volume by design (§2.3) |
| Local development | Leave `LOG_JSON_CONSOLE=false` | Colorized, human-readable single-line console output |
| Debugging in a shared/office environment | Set `LOG_JSON_CONSOLE=true`, `LOG_LEVEL=info` | JSON console output, closer to what production emits, without touching code |
| Adding an alerting/aggregation backend later (ELK, Loki, Datadog) | Add a new winston transport in `winston-logger.factory.ts` | The JSON format is already aggregator-ready — no format changes needed, just a new transport |

---

## 5. Developer guide

### 5.1 Reading the current request's context from your own service

```ts
constructor(private readonly requestContextService: RequestContextService) {}

someMethod() {
  const correlationId = this.requestContextService.get('correlationId');
  const userId = this.requestContextService.get('userId');
}
```

You will rarely need this directly — it's mainly for the winston format pipeline. Reach for it only if you need the current request's identity in application logic itself (e.g. an audit trail), not just in logs.

### 5.2 Adding a new redacted field

Add the key to `DEFAULT_REDACTED_KEYS` in `constants/logger.constants.ts`. The match is case-insensitive and applies at any nesting depth — no changes needed anywhere else.

### 5.3 Adding a new transport (e.g. shipping to a log aggregator)

Add it inside `buildWinstonModuleOptions()` in `winston-logger.factory.ts`, gated by its own `LOG_*_ENABLED` env flag following the existing pattern (`config.consoleEnabled`, `config.fileEnabled`, `config.errorFileEnabled`). Reuse `baseFormat` so the new transport gets correlation enrichment and redaction for free.

### 5.4 Dropping this module into a new project

1. Copy `src/shared/logger/` in full.
2. Merge `loggerEnvSchema` into the new project's root env schema, same one-line pattern as `healthEnvSchema` (§2.2).
3. Import `LoggerModule` in the new project's `AppModule`, and register `RequestContextMiddleware` immediately after whatever sets the correlation ID (or add `CorrelationIdMiddleware` too if the new project doesn't already have one — it's a five-line file).
4. Register `LoggingInterceptor` as an `APP_INTERCEPTOR`, ordered **before** any response-shaping interceptor (see §6 on why order matters).
5. In the new project's `main.ts`, add `{ bufferLogs: true }` to `NestFactory.create()` and `app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER))` right after.

### 5.5 Testing gotchas

There are currently no `.spec.ts` files for this module — that's a gap relative to the rest of this codebase (`pagination/test/`, `utils/test/` both exist), not a deliberate choice. If you're extending this module, the parts most worth covering first:

- `redactSensitiveFields()` — pure function, trivial to test directly, and would have caught the `Error`-instance gap in §2.6 immediately.
- `RequestContextService` — verify two sibling async callbacks opened via separate `run()` calls don't see each other's store.
- `buildWinstonModuleOptions()` — given a fake config, assert the right transports/levels/filenames come out, without needing a running Nest app.

---

## 6. Conventions & best practices

- **Never** log full request/response bodies by default. This module deliberately only logs method/path/status/duration/ip — not payloads — to avoid PII/PHI exposure risk (this is a health-product domain) and to keep the redaction surface area small. If you need body logging for a specific debug session, treat it as an explicit, reviewed opt-in, not a default.
- **Always** keep `LoggingInterceptor` registered as `APP_INTERCEPTOR` *before* `ResponseInterceptor` in `app.module.ts` — Nest runs interceptors' post-handler phase in reverse registration order, so this ordering makes the access-log line reflect the actually-final response.
- **Never** read `response.statusCode` from an RxJS `finalize()`/`tap()` operator to log an HTTP status — it can run before `GlobalExceptionFilter` sets the real status on an error path (§2.5). Use `response.on('finish', ...)`.
- **Always** register `RequestContextMiddleware` immediately after `CorrelationIdMiddleware`, never before — it depends on `req.correlationId` already being set (§2.1).
- **Always** add new tunables (log level, size, retention) to `logger.env.ts`/`logger.config.ts` — never hardcode them in `winston-logger.factory.ts`, see §2.2.
- Keep the error-file transport's level hardcoded to `'error'` — it is not meant to be reconfigurable; that would defeat its one job (§2.3).
- Be aware of the `Error`-instance redaction gap (§2.6) if you ever log a raw `Error` object as metadata rather than a message string.
- `src/shared/logger` stays under `src/shared/`, not `src/modules/` — it's cross-cutting infrastructure with no business-domain knowledge, same reasoning as `src/health` and `src/shared/storage`.
