# Rate Limiting — Concepts, Features & Developer Guide

This document explains *what* `src/common/throttler` does, *why* each decision was made, and *how* to
change a limit without breaking the guarantees the rest of the API depends on. Like `src/health`, this
is infrastructure rather than domain logic: the module knows nothing about users, blogs or any other domain,
and the whole folder can be copied into another service unchanged.

It also records, in §7, everything rate limiting in this project does **not** yet do. Those gaps are
listed deliberately rather than discovered during an incident.

Assumes familiarity with [`error-handling.md`](./error-handling.md) and [`health-check.md`](./health-check.md).

---

## 1. Purpose

An API with no rate limiting has no answer to a caller who simply asks too often. Three concrete
failures follow, and none of them are hypothetical for this application:

- **Credential stuffing.** `POST /auth/login` runs a bcrypt compare against a real password hash.
  Unlimited, it accepts password guesses as fast as the network allows, and the bcrypt cost that makes
  the hash secure becomes the attacker's lever for exhausting CPU.
- **OTP brute force.** A 6-digit numeric code has 10⁶ values. At a few thousand requests per second
  that is minutes of guessing, and the code is the only thing standing between a caller and someone
  else's account on the password-reset path.
- **Cost and abuse amplification.** Signup, forgot-password and OTP-resend each send a real outbound
  email. Uncapped, forgot-password is not merely a cost sink — it is a mail-bombing tool pointed at an
  address of the attacker's choosing.

`src/common/throttler` exists to put a per-caller budget in front of all of it, and to make the
resulting `429` legible to the person who hits it.

---

## 2. Key concepts

### 2.1 Three layers — only one of them lives in this repo

Rate limiting is three independent layers. Conflating them is why single-`ThrottlerModule` setups
disappoint in production.

| Layer | Stops | Where it lives |
|---|---|---|
| **Edge** — volumetric floods, L3/L4, botnets | Traffic that must never reach Node at all | nginx `limit_req`, CDN/WAF — infrastructure, not this repo |
| **Application** — per-caller request budgets | Abusive-but-connected clients | `src/common/throttler` (this document) |
| **Business** — per-identity abuse of one flow | Credential stuffing and OTP guessing against a *known* account | Account lockout, per-OTP attempt caps — see §7.2 and §7.3 |

The application layer cannot substitute for the business layer. An attacker spreading 10,000 guesses
against one account across 10,000 IPs defeats *any* per-IP limit, and is stopped cold by a per-account
lockout. Both are required; today only the middle row is implemented.

### 2.2 The enforcement path — options configure, the guard enforces

`ThrottlerModule.forRoot()` / `forRootAsync()` register **options and a storage service only**. They
apply nothing on their own. `ThrottlerGuard.canActivate()` is the one thing that counts a request, and
it runs only if something puts it in the pipeline.

That distinction is the whole reason this module exists as its own folder: for as long as this app had
`ThrottlerModule` configured without a guard, every route was unlimited while the configuration in
`app.module.ts` and the `@SkipThrottle()` on `HealthController` made the API *look* protected during
review — worse than having no throttler installed at all.

`AppThrottlerModule` therefore owns the registration itself:

```ts
providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
```

The per-request path, once the guard is in place:

1. The guard resolves a **tracker** via `getTracker(req)` — see §2.6.
2. It hashes `ControllerName-handlerName-throttlerName-tracker` into a storage key, so a bucket is
   **per route handler**, not per API surface. Budgets do not bleed between endpoints.
3. It calls `storage.increment(...)` and sets `X-RateLimit-Limit`, `-Remaining`, `-Reset`.
4. Over the limit, it sets `Retry-After` and throws `ThrottlerException` (HTTP 429).

### 2.3 Named tiers compose

v6 evaluates **every** configured throttler on every request and requires **all** of them to pass. Two
named tiers are registered globally, so a burst ceiling and a sustained ceiling apply simultaneously:

| Tier | Window | Limit | Absorbs / stops |
|---|---|---|---|
| `short` | 10 s | 30 | A page load's parallel XHRs, while still killing scripted floods |
| `long` | 60 s | 200 | The real sustained policy ceiling |

Both are env-driven (§2.10). The names are exported as `THROTTLER_SHORT` / `THROTTLER_LONG` and must
never be typed as string literals at a call site — see §2.8 for what silently breaks when a tier name
and a decorator disagree.

### 2.4 Per-route overrides are code constants, and why

Security-critical and mail-sending routes narrow the `short` tier locally:

```ts
@Throttle({ [THROTTLER_SHORT]: LOGIN_THROTTLE })
@Post('login')
```

Every override lives in `src/common/throttler/throttler.constants.ts`, and every one of them is
strictly tighter than 200-per-minute, so the `long` tier can never bind first on those routes.

**These are code constants rather than `THROTTLE_*` env vars, on purpose.** `@Throttle()` is a
decorator: it is evaluated when the controller file is first imported, during module resolution,
*before* `ConfigModule` has loaded any `.env` file into `process.env`. An env-driven value there would
read `undefined` at decoration time and silently fall back to the global tier — a limit that looks
configured while actually being 30-per-10s instead of 3-per-hour. Retuning one route is a code change
by design; the operational escape hatch is `THROTTLE_ENABLED` (§6.5), which kills the whole limiter.

### 2.5 `blockDuration` — the penalty that outlasts the window

Without it, a caller over the limit waits out one `ttl` and resumes at full rate, so the sustained cost
of an attack is only about 50% throughput. With it, tripping the limit costs a fixed penalty regardless
of the window.

It is applied only where the endpoint is a guessing surface — login, reset-password, OTP verify — and
deliberately **not** on the mail-cost routes. Someone who genuinely fat-fingers three signups should be
able to retry after the hour, not serve an extra sentence on top of it.

### 2.6 The tracker, `trust proxy`, and what `req.ip` really is

`AppThrottlerGuard.getTracker()` returns `user:<id>` when a user is present and `ip:<ip>` otherwise.
The `user:` branch does not fire today — see §7.5 — so in practice every bucket is keyed by IP.

Which makes `req.ip` the single most load-bearing value in the module. Express derives it from the
socket unless told how many reverse proxies sit in front, via `THROTTLE_TRUST_PROXY_HOPS`:

```ts
app.set('trust proxy', trustProxyHops);   //* src/main.ts
```

Both ways of getting the number wrong fail silently, and they fail differently:

| Wrong direction | What happens |
|---|---|
| **Too low** (e.g. `0` behind nginx) | Every caller presents as the proxy's IP and the entire internet shares **one bucket**. The first 30 requests per 10s from anyone exhaust it for everyone — the limiter becomes the denial of service. |
| **Too high** | `X-Forwarded-For` is client-controlled. Trusting more hops than physically exist lets a caller spoof a fresh IP per request and mint an unlimited number of buckets. The limiter is bypassed entirely. |

Never set it to `true`; that is the second row with no ceiling. The correct value is the real hop count
and nothing else, which is why each environment sets it explicitly:

| Environment | Hops | Topology |
|---|---|---|
| Production (example) | `1` | `client → nginx → Nest`. One reverse proxy terminating TLS. Putting Cloudflare or a cloud load balancer in front adds a hop each. The app never terminates TLS itself — `main.ts` only calls `app.listen(port)`. |
| Internal / staging (example) | `0` | Reached directly as `host:port`. A NAT/router port-forward is **not** a proxy hop: it rewrites addresses but sets no `X-Forwarded-For`. |
| Development | `0` | Nothing is in front of `localhost`. |

Because this cannot be validated from a dev machine, the guard verifies it against real traffic
instead — see §6.6.

### 2.7 Guard ordering — throttling runs before auth

`AppThrottlerModule` is imported **first** in `AppModule`, so its `APP_GUARD` is the first guard in the
pipeline. It is the only `APP_GUARD` in the app; `JwtAuthGuard` and `RolesGuard` are controller-scoped
via `@UseGuards`, so nothing runs ahead of the throttler.

The choice is mutually exclusive and was made deliberately:

| Order | Consequence |
|---|---|
| Throttler **before** auth (chosen) | Protects the auth guard itself — JWT verification and bcrypt — from being hammered, and is the only order under which public routes like `login` and `create-user` are protected at all. But `req.user` is unset, so **only IP tracking is possible**. |
| Throttler **after** auth | `req.user` is available so per-user quotas work — but every unauthenticated request pays for full JWT verification before any limit applies, and `login` gets nothing. |

Protecting the auth path is worth more than per-user precision on already-authenticated traffic. Per-user
quotas, if they are ever needed, arrive as a *second* throttler registered after the auth guard — a
registration change, not an edit to the existing tracker.

### 2.8 Exemptions — `SKIP_ALL_THROTTLERS`, never bare `@SkipThrottle()`

```ts
@SkipThrottle(SKIP_ALL_THROTTLERS)
@Controller('health')
export class HealthController { ... }
```

`@SkipThrottle()` with no argument defaults to `{ default: true }` — it exempts only a throttler
*literally named* `default`, which is the name an unnamed `forRoot` throttler receives. The moment the
tiers became named `short`/`long`, every bare `@SkipThrottle()` in the codebase matched nothing and
silently stopped exempting anything.

That is not hypothetical: it was caught on `HealthController`, where it meant an orchestrator polling
`/health/live` every few seconds would trip the burst tier and get the container killed for the wrong
reason — precisely the failure that decorator was added to prevent. A container `HEALTHCHECK`
polls `/health/ready` every 15 s, so the exemption is load-bearing, not decorative.

**Adding a new tier means adding it to `SKIP_ALL_THROTTLERS` too.**

### 2.9 The 429 contract

The message is built where the limit trips, because that is the only point that still holds `limit`,
`ttl` and `timeToBlockExpire`; by the time `GlobalExceptionFilter` sees the exception they are gone.
`AppThrottlerGuard.throwThrottlingException()` therefore composes the sentence and sets the header,
and the filter passes both through:

```json
{
  "statusCode": 429,
  "success": false,
  "message": "You've tried more than 5 times within 1 minute. Please try again after 15 minutes.",
  "error": "Too Many Requests",
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 900,
  "timestamp": "..."
}
```

Four details are deliberate:

- **The numbers are never duplicated.** They come from the throttler's own limit detail at the instant
  the limit trips, so retuning a constant or a `THROTTLE_*` var changes the sentence automatically and
  the documentation-in-the-message cannot drift.
- **Branch order in the filter is load-bearing.** `ThrottlerException extends HttpException`, so placed
  after the generic branch this mapping would be unreachable and the client would receive the library's
  raw default, `"ThrottlerException: Too Many Requests"` — a leaked internal class name in a
  user-facing string. Same reasoning as `TokenExpiredError` preceding `JsonWebTokenError`.
- **`Retry-After` is set explicitly by the guard.** The library suffixes the header with the tier name —
  it sets `Retry-After-short`, never plain `Retry-After`, because these throttlers are named. Without
  the explicit set, the one header every HTTP client, proxy and browser devtool looks for is absent.
- **`retryAfter` is mirrored into the body.** The frontend's axios interceptor rebuilds every failure
  from `response.data` alone, so a header-only value never reaches a screen.

On the client, `errorCode: RATE_LIMIT_EXCEEDED` is the stable identifier to branch on; `message` is
safe to display verbatim, and `retryAfter` drives the countdown on the `/rate-limit` page.

### 2.10 Config — self-contained, validated, millisecond-named

`src/common/throttler/config/` follows the same convention as `src/health/config/`: its own zod schema,
its own `registerAs('throttler', …)` factory, no dependency on the app shell. The schema is merged into
`src/config/env.validation.ts` with one line, so a bad value fails at boot rather than at runtime.

| Variable | Default | Purpose |
|---|---|---|
| `THROTTLE_ENABLED` | `true` | Kill switch, wired through `skipIf` (§6.5) |
| `THROTTLE_SHORT_TTL_MS` / `_LIMIT` | `10000` / `30` | Burst tier |
| `THROTTLE_LONG_TTL_MS` / `_LIMIT` | `60000` / `200` | Sustained tier |
| `THROTTLE_TRUST_PROXY_HOPS` | `0` | Reverse-proxy hops (§2.6) |
| `THROTTLE_REDIS_URL` | — | Parsed, **not yet consumed** (§7.1) |

Every window is suffixed `_MS` and is in milliseconds. That naming is the point: `@nestjs/throttler`
changed `ttl` from seconds to milliseconds in v5, and the config this module replaced — `ttl: 60` in
`app.module.ts` — was a **60-millisecond** window wearing a "reset counter after 60 seconds" comment.
That is roughly 1,666 req/s: a limiter that stops nothing while appearing configured. Naming the unit
at the config layer makes the mistake unrepresentable.

`THROTTLE_ENABLED` is wired through `skipIf` rather than conditional module registration on purpose:
conditional registration changes the DI graph between environments, which is how "works in staging"
bugs are born.

### 2.11 Storage — in-process

No `storage` is supplied, so the built-in `ThrottlerStorageService` is used: a `Map` in the Node heap.
This is correct **only** for a single-instance deployment, which is what this app is today. The
consequences are real and are covered as a limitation in §7.1.

---

## 3. The limits in force today

**Global tiers** — every route, both must pass:

| Tier | Window | Limit |
|---|---|---|
| `short` | 10 s | 30 |
| `long` | 60 s | 200 |

**Per-route overrides** — narrow the `short` tier only; the `long` tier stays at its global setting:

| Route | Limit | Window | Block | Rationale |
|---|---|---|---|---|
| `POST /auth/login` | 5 | 1 min | 15 min | Bcrypt-expensive and security-critical. 5/min is far above human behaviour |
| `POST /auth/refresh` | 20 | 1 min | — | Legitimate clients refresh rarely; a burst indicates a token-replay loop |
| `POST /user/create-user` | 3 | 1 hour | — | Signup spam and mail-cost control — every accepted call sends an OTP email |
| `POST /user/forgot-password` | 3 | 1 hour | — | Same shape as signup, except the mail lands in someone else's inbox |
| `POST /user/reset-password` | 5 | 5 min | 15 min | OTP-guessing surface first, bcrypt cost second |
| `POST /otp/verify-otp` | 5 | 5 min | 15 min | OTP guessing — per-IP half only, see §7.3 |
| `POST /otp/resend-otp` | 3 | 1 hour | — | Outbound-mail cost; sits on top of `OtpService`'s own 60 s per-identifier cooldown |

**Exempt:** `/health/*`, via `@SkipThrottle(SKIP_ALL_THROTTLERS)` (§2.8).

**Not limited by the throttler at all:** everything in §7.6.

---

## 4. Features & benefits

- **Actually enforced.** The guard is registered by the module that owns the config, so configuration
  and enforcement cannot drift apart (§2.2).
- **Composable tiers.** A burst ceiling and a sustained ceiling apply at once, and per-route overrides
  narrow one tier without disturbing the other (§2.3, §2.4).
- **Unit-safe config.** `_TTL_MS` naming makes the v5 seconds→milliseconds change unrepresentable
  (§2.10).
- **Proxy-aware, and self-checking.** The hop count is explicit per environment, and the guard verifies
  it against real traffic on the first throttled request of each process (§2.6, §6.6).
- **Readable failures.** The 429 carries the real limit, the real window and the real wait, generated
  from the same values that enforce them (§2.9).
- **A reachable kill switch.** `THROTTLE_ENABLED=false` reverts every route with a restart, not a
  deploy (§6.5).
- **Portable.** The folder validates its own env and depends on nothing app-specific; copying it into
  another service is a folder copy plus one `.merge()` line.

---

## 5. Use cases — what each control defends against

| Scenario | Control | Why this shape |
|---|---|---|
| Password spraying across many accounts from one IP | `LOGIN_THROTTLE`, 5/min + 15 min block | The block is what makes it expensive; without it the attacker keeps ~50% throughput indefinitely |
| Brute-forcing one account's password | *(not covered)* | Per-IP limiting cannot stop a distributed attacker — needs the account lockout in §7.2 |
| Guessing a password-reset OTP | `RESET_PASSWORD_THROTTLE` + `OTP_VERIFY_THROTTLE`, 5/5 min + 15 min block | Caps the per-IP guess rate; the per-code cap in §7.3 is the other half |
| Mail-bombing a chosen address | `FORGOT_PASSWORD_THROTTLE`, 3/hour | The cooldown in `OtpService` is keyed by identifier and would not stop one IP cycling through addresses |
| Signup spam / outbound mail cost | `SIGNUP_THROTTLE`, 3/hour | Each accepted call is a real email |
| A page issuing many parallel XHRs | `short` tier, 30/10 s | Sized to absorb a real page load rather than punish it |
| Orchestrator probing `/health/*` every few seconds | Exempt | A 429 here gets a healthy container killed (§2.8) |

---

## 6. Developer guide

### 6.1 Add a limit to a new route

1. Add the constant to `throttler.constants.ts` with a comment saying *why* that number — the file is
   the single place a reviewer looks for the policy.
2. Apply it to the handler, always keyed by the exported tier name:

   ```ts
   import { Throttle } from '@nestjs/throttler';
   import { THROTTLER_SHORT, MY_ROUTE_THROTTLE } from '@/common/throttler/throttler.constants';

   @Throttle({ [THROTTLER_SHORT]: MY_ROUTE_THROTTLE })
   @Post('my-route')
   ```

3. Keep the override tighter than the `long` tier (200/min), or state explicitly why it should not be.
4. Document it in §3.

### 6.2 Retune an existing limit

Global tiers are env vars — change `THROTTLE_SHORT_LIMIT` and restart. Per-route overrides are code
constants and require a deploy, for the decorator-evaluation-order reason in §2.4. Update §3 in the
same commit.

### 6.3 Exempt a route

`@SkipThrottle(SKIP_ALL_THROTTLERS)`. Never the bare `@SkipThrottle()` (§2.8). Exemptions are for
infrastructure endpoints, not for endpoints that are merely inconvenient to limit.

### 6.4 Add a new tier

Register it in `AppThrottlerModule`, export its name as a `THROTTLER_*` constant, **and add it to
`SKIP_ALL_THROTTLERS`** — otherwise every existing exemption silently stops covering the new tier.

### 6.5 Turn the limiter off during an incident

```bash
THROTTLE_ENABLED=false   # then restart
```

This is a restart, not a deploy, and it disables limiting on **every** route — `AppThrottlerModule`
logs a warning at boot saying so. Prefer raising the specific tier that is misfiring; reach for the
switch only when you do not yet know which one that is.

### 6.6 Deploy behind a proxy, or change the hop count

Set `THROTTLE_TRUST_PROXY_HOPS` to the real hop count (§2.6) and make sure the proxy actually sends the
header:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

The value cannot be validated locally — there is no proxy in front of `localhost` to produce a
forwarding chain to count. The guard therefore performs the check against real traffic on the first
throttled request of each process and logs the verdict once. After deploying, grep the logs for
`AppThrottlerGuard`:

| Log level | Meaning |
|---|---|
| `log` — "Rate-limit bucketing verified…" | `req.ip` resolves correctly; nothing to do |
| `error` — "…is too low" | Requests carry `X-Forwarded-For` but `req.ip` is still the socket address: everyone is sharing one bucket. Raise the hop count |
| `warn` — "…no X-Forwarded-For header" | Hops are configured but nothing is forwarding: either the value should be `0`, or the proxy is missing the `proxy_set_header` line |

It is logged once per process, not once per request — it describes deployment configuration, and a
per-request version would flood the logs at exactly the moment something is wrong.

### 6.7 Verify a limit locally

Guards run **ahead of** the `ValidationPipe`, so a request with an empty body still consumes budget.
That makes limits verifiable without creating a single row — the pre-limit responses are `400`s and the
post-limit ones are `429`s:

```bash
for i in $(seq 1 7); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:8000/api/v1/auth/login \
    -H 'Content-Type: application/json' -d '{}'
done
# 400 400 400 400 400 429 429
```

To confirm `blockDuration` rather than just the window, re-hit the route after the `ttl` has elapsed but
before the block has: it must still return `429`.

---

## 7. Known limitations

Everything below is a deliberate, recorded gap — not an oversight. Ordered by how much risk it carries.

### 7.1 Counters are per-process and die on restart

The built-in in-memory storage (§2.11) has three consequences:

- **Multi-instance breaks the policy.** With *N* instances behind a load balancer the effective limit is
  *N × limit*, varying with autoscaling. The stated policy becomes unknowable. **Going multi-instance
  makes Redis storage mandatory, not optional.**
- **Every deploy resets every bucket.** An attacker mid-brute-force gets a clean slate on each restart.
- **Unbounded key growth under a distributed attack.** The map grows on the very node being attacked.

`THROTTLE_REDIS_URL` is already parsed and validated so that adopting Redis is a config change plus one
`storage:` line rather than a refactor, and `AppThrottlerModule` logs a loud warning if the variable is
set while the storage is still in-memory — so it can never *look* like distributed limiting is on when
it is not.

When it is wired: verify the storage adapter's peer range against `@nestjs/throttler@6` (the
`increment()` signature gained `blockDuration` and `throttlerName` in v5/v6), and decide the
Redis-unavailable behaviour explicitly. **Fail-open** — serve the request unthrottled and log loudly —
is the right default for a commerce API; fail-closed turns a cache outage into a full outage.

### 7.2 There is no per-account lockout

`UserSecurity.loginAttempts` is incremented on every failed password compare and reset on success.
**Nothing reads it.** The schema, the repository method and its `//* Increments failed login attempts
for security throttling.` comment all advertise a protection that does not exist.

This is the §2.1 business layer, and it is the control that actually stops credential stuffing: per-IP
limiting is defeated by an attacker distributing guesses across many IPs.

Implementing it needs a migration — the model has `loginAttempts` but no `lockedUntil` and no
`lastFailedLoginAt`, and without a timestamp the counter never decays, so a user who fails twice today
and three times next month eventually locks out from ordinary forgetfulness. Three details separate a
correct implementation from a naive one:

- **Do not tell the caller the account is locked.** "Account locked" on a wrong password is a user
  enumeration oracle — it confirms the address is registered. Return the same generic
  `Invalid credentials`, and notify the real owner by email instead.
- **Prefer exponential backoff to a hard lock.** A hard lock is itself a denial-of-service vector:
  anyone who knows a victim's email can lock them out on demand. If a hard lock is chosen anyway, keep
  the window short and always provide self-service unlock through the existing reset flow.
- **Increment outside the request transaction**, or a failed attempt that errors later leaves no trace.

### 7.3 OTP verification has no per-code attempt cap

`OTP_VERIFY_THROTTLE` is the **per-IP half only**. A distributed guesser rotating IPs still gets
unlimited attempts against one victim's code.

The missing half is not a rate limiter at all — it is a counter column on the OTP row: cap verification
attempts per OTP record (5 is the natural match for the per-IP number), then invalidate the code and
force a resend. It is the single highest-value control on that endpoint.

Issuance is in better shape: `OtpService` enforces a 60 s cooldown per identifier, and
`OTP_RESEND_THROTTLE` caps issuance per IP on top of it.

### 7.4 429s are not observable

Nothing logs or counts throttle events, so there is no signal to alert on and no data to tune limits
with. Every number in §3 is a starting estimate until real traffic contradicts it — and the two failure
modes are indistinguishable from inside the process:

| Signal | "We are under attack" | "Our limits are too tight" |
|---|---|---|
| 429 rate | Spikes | Steadily elevated |
| Distinct trackers tripping | Few, or thousands of one-shot IPs | Many, each tripping repeatedly |
| Endpoints affected | Concentrated on `login` / `verify-otp` | Spread across read endpoints |
| Correct response | Tighten, escalate to the edge layer | **Loosen immediately** |

Getting it backwards is expensive in both directions. Distinguishing them needs 429 data aggregated
across time and instances, which means logging the event at `warn` with the tier that fired, the route,
the tracker, `totalHits`, the limit and the window. `correlationId`, `userId` and `role` are already
stamped on every line by the existing logger enrichment, so nothing extra is needed for tracing —
`errorCode: RATE_LIMIT_EXCEEDED` (§2.9) exists precisely so the query is a field match rather than a
string search. Two alerts are needed, not one: a spike alert and a sustained-elevated alert.

### 7.5 Per-user quotas are unreachable today

`getTracker()` has a `user:<id>` branch that never fires, because the throttler is an `APP_GUARD` and
runs before the controller-scoped `JwtAuthGuard` (§2.7). Every bucket is keyed by IP, which means one
NAT'd office shares a single budget on authenticated routes.

The branch is kept so that adding a second, post-auth throttler later is a registration change rather
than an edit here. Until then, the office deployment is the one most likely to feel it — admin tools do
bulk operations, and limits calibrated on public traffic will strangle them.

### 7.6 Surfaces the guard never sees

An `APP_GUARD` does not close everything:

- **`ServeStaticModule` at `/uploads`** is Express middleware, not a Nest route. The global guard does
  not run for it; bandwidth abuse there needs edge or CDN controls.
- **Swagger UI at `/api-doc`** is likewise outside the guard.
- **Cost-asymmetric endpoints** — file upload, bulk imports, report aggregations — need
  budgets sized by cost, not by request count. "10 requests" means little when one request writes a
  20 MB file.

### 7.7 Nothing tests any of this

There are no automated tests for the throttler. The specific defect this module was built to fix — a
module imported but never applied — is invisible to the type checker, to lint and to every existing
test, and will regress silently. The highest-value additions, in order:

1. **Registration test.** Assert the compiled `AppModule` provides `APP_GUARD` with `AppThrottlerGuard`.
   One assertion; it is the entire lesson of §2.2.
2. **Behavioural e2e.** Hit a throttled route `limit + 1` times; assert 429, the envelope with
   `errorCode: 'RATE_LIMIT_EXCEEDED'`, and that `Retry-After` and `X-RateLimit-*` are present.
3. **Window arithmetic.** Assert a 60-second route rejects on the 61st second, not the 61st millisecond
   — the test that would have caught the §2.10 unit bug.
4. **Health exemption.** Hammer `/health/live` past the limit and assert it still returns 200 — the
   regression in §2.8, made permanent.

### 7.8 Copies of this template drift

Every project started from this template carries its own copy of the throttler config, the health
exemption and the exception filter. A security fix made in one copy has to be ported to the others by
hand, and nothing enforces that.

### 7.9 Messages are English only

The 429 sentence is generated server-side in English (§2.9) and the frontend toasts it verbatim, which
is the established contract for this API's errors. If the frontend has multiple locales, a localized 429
means building the string client-side from `errorCode` plus the numeric `retryAfter` rather than
displaying `message`. The structured fields are already in the body for exactly that.

---

## 8. Conventions & best practices

- **Always** key `@Throttle()` and `@SkipThrottle()` off the exported `THROTTLER_*` / `SKIP_ALL_THROTTLERS`
  constants, never string literals. A tier name typed by hand is a limit that silently does nothing.
- **Always** add a new tier to `SKIP_ALL_THROTTLERS` in the same commit that registers it (§6.4).
- **Always** name a window `_MS` and express it in milliseconds (§2.10).
- **Never** set `trust proxy` to `true`, and never raise the hop count without a topology change to
  justify it (§2.6).
- **Never** put a per-route limit in an env var — the decorator is evaluated before config loads
  (§2.4).
- **Never** widen a limit to make a test or a bulk script pass; use `THROTTLE_ENABLED=false` locally
  instead, so the committed numbers stay honest.
- **Prefer** adding `blockDuration` on any endpoint where a wrong answer is a guess at a secret, and
  omitting it where the endpoint merely costs money to call (§2.5).
- Keep `src/common/throttler` free of domain imports. It validates its own env and is meant to be
  copyable; a single `import` from `src/modules` ends that.
- Treat a rollout as user-facing: start loose, watch the frontends first, and tighten only once
  §7.4's data exists. The failure mode is silent — legitimate users get 429s and simply leave.

---

## 9. References

- [`error-handling.md`](./error-handling.md) — the response envelope, `errorCode` contract, and why
  filter branch order is load-bearing
- [`health-check.md`](./health-check.md) §2.7 — why `HealthController` is exempt
- [`../user.md`](../user.md) — the write-only `loginAttempts` counter behind §7.2
- `@nestjs/throttler` v6 — named throttlers, `blockDuration`, and the millisecond `ttl` unit introduced
  in v5
- OWASP — *Blocking Brute Force Attacks* and the *Authentication Cheat Sheet*, for the account-lockout
  and user-enumeration trade-offs in §7.2
