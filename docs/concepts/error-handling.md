# Error Handling — Concepts, Contract & Developer Guide

This document explains *what* the error-handling layer does, *why* it is built this way, and *how* to use or extend it without breaking the API contract that every client depends on.

Like `src/shared/logger` and `src/health`, this is **infrastructure**: it knows nothing about users, blogs, or any other domain. That is what makes it portable — and what makes it dangerous to bypass. A single controller that formats its own error response silently breaks every client's error handling.

**Primary source files**

| File | Role |
|---|---|
| `src/common/errors/global-exception.filter.ts` | The single place any error becomes an HTTP response |
| `src/common/interceptors/response.interceptor.ts` | The single place any success becomes an HTTP response |
| `src/modules/auth/guards/jwt-auth.guard.ts` | Translates passport-jwt internals into the public auth-error contract |
| `src/common/utils/validation.util.ts` | Safe extraction of `class-validator` constraint messages |
| `src/main.ts` | `ValidationPipe` + `useGlobalFilters` registration |

---

## 1. Purpose

An API is a contract, and the error half of that contract is the half clients actually have to program against. Success responses are read by a human once during integration; error responses are branched on in code, forever.

This layer exists to make six things true at once:

1. **Exactly one response shape for every failure** — a 404 from Prisma, a 400 from `class-validator`, a 401 from passport, and an unhandled `TypeError` all come back looking identical.
2. **No internal detail ever leaks in production** — no schema names, no stack traces, no ORM error text.
3. **Every message is safe to render directly to an end user** — no library internals like `"No auth token"` in the UI.
4. **Clients branch on stable codes, not on English prose** — so copy edits and dependency upgrades don't break the frontend.
5. **Business code throws and forgets** — no service needs to know what HTTP is.
6. **Every 5xx is logged with a stack trace and a correlation ID**, and no 4xx is (client mistakes are not incidents).

The core design rule, from which everything else follows:

> **Controllers and services never build an error response. They `throw`. The filter is the only component that knows what an HTTP error body looks like.**

---

## 2. The response contract

### 2.1 Success envelope

Built by `ResponseInterceptor` (`src/common/interceptors/response.interceptor.ts`). Controllers just `return` a value.

```jsonc
{
  "statusCode": 200,
  "success": true,
  "message": "Blogs retrieved successfully",     // from @ResponseMessage(), else "Operation successful"
  "data": { /* whatever the controller returned */ },
  "meta": { /* present ONLY for IPaginatedResult returns */ }
}
```

The interceptor detects a paginated result structurally (`'data' in value && 'meta' in value`) and hoists `meta` to the top level. Everything else is passed through as `data`.

### 2.2 Error envelope

Built by `GlobalExceptionFilter`. **Errors never pass through `ResponseInterceptor`** — a thrown exception short-circuits the RxJS stream, so the success envelope is never applied. This is why `success` can be hardcoded `true` in one file and `false` in the other with no conflict.

```jsonc
{
  "statusCode": 401,
  "success": false,
  "message": "Please log in to continue.",   // SAFE TO SHOW A USER. string | string[]
  "error": "Unauthorized",                   // coarse category, for logs/debugging
  "errorCode": "AUTH_TOKEN_MISSING",         // OPTIONAL — stable machine code, see §5
  "timestamp": "2026-07-27T05:01:50.299Z"
}
```

### 2.3 Field semantics — the part that matters

Getting these three fields confused is the most common way this contract rots. They are not interchangeable.

| Field | Audience | Stability | Rule |
|---|---|---|---|
| `message` | **The end user.** Rendered in a toast/inline error. | Free to reword anytime. | Must never contain a table name, column name, stack frame, or library string. May be a `string[]` for validation (see §7). |
| `error` | **The developer.** Shows up in logs and bug reports. | Loosely stable. | A coarse category (`Unauthorized`, `Not Found`, `Validation Error`, `Database Error (P2014)`). Never branch on it in client code. |
| `errorCode` | **The client program.** | **Frozen once published.** | `SCREAMING_SNAKE_CASE`. The only field a frontend `switch` may key on. Absent when the thrower didn't supply one. |

`errorCode` is deliberately **optional**. It is emitted only when the thrower provides it (`...(errorCode ? { errorCode } : {})`), so adding codes to new failure modes never changes the shape of responses that don't have one. This is what makes rollout incremental rather than a breaking change.

---

## 3. Where errors come from

Understanding the request lifecycle tells you which component can produce which failure, and therefore where a fix belongs.

```
   HTTP request
        │
        ▼
   CorrelationIdMiddleware ──── sets x-correlation-id (echoed on the response header)
        │
   RequestContextMiddleware ─── opens the AsyncLocalStorage scope
        │
   LoggingInterceptor ───────── starts the timer; logs once on response 'finish'
        │
   ResponseInterceptor ──────── (success path only, on the way back out)
        │
        ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Guards      JwtAuthGuard   → 401  (missing/expired/invalid) │
   │              RolesGuard     → 403  (insufficient privileges) │
   │  Pipes       ValidationPipe → 400  (DTO shape violations)    │
   │  Controller  @Throttler     → 429                            │
   │  Service     domain rules   → 400/403/404/409                │
   │  Prisma      DB constraints → mapped, see §8                 │
   │  Anything    a real bug     → 500                            │
   └─────────────────────────────────────────────────────────────┘
        │
        ▼  every throw from any of the above lands here
   GlobalExceptionFilter  (@Catch() — no argument, so it catches EVERYTHING)
        │
        ├─ statusCode >= 500 → logger.error(message, stack)   ← correlationId auto-stamped
        └─ response.status(code).json({ envelope })
```

Two consequences worth internalizing:

- **`@Catch()` with no argument** means this filter is the last line of defense for non-`Error` throws too (`throw 'boom'`, a rejected promise with a string). Those fall through every `instanceof` branch and produce the generic 500 — which is the correct, safe behavior.
- The filter is registered in `main.ts` as `app.useGlobalFilters(new GlobalExceptionFilter())` — **manually instantiated, so it has no dependency injection**. That is why it uses `new Logger(...)` and reads `process.env.NODE_ENV` directly instead of injecting `ConfigService`. If the filter ever needs an injected dependency, it must be re-registered as `{ provide: APP_FILTER, useClass: GlobalExceptionFilter }` in `app.module.ts`.

---

## 4. Filter branch order is load-bearing

`GlobalExceptionFilter.catch()` is a single `if / else if` chain. **Order is not stylistic — it is correctness**, because several of these classes are subclasses of each other. A more general branch placed above a more specific one makes the specific one unreachable dead code.

Current order and the reason for each position:

| # | Branch | Must be above | Why |
|---|---|---|---|
| 1 | `TokenExpiredError` | `JsonWebTokenError` | **`TokenExpiredError extends JsonWebTokenError`.** If the parent is tested first, expiry is reported as "Invalid token" and the client hard-logs-out instead of refreshing. |
| 2 | `JsonWebTokenError` | `HttpException` | Raw `jsonwebtoken` errors are not `HttpException`s at all; this converts them to 401 rather than 500. |
| 3 | `BadRequestException` | `HttpException` | `BadRequestException extends HttpException`. Needs its own branch to unwrap `class-validator` payloads. |
| 4 | `HttpException` | Prisma / `Error` | Generic catch-all for every Nest exception (`NotFoundException`, `ConflictException`, custom subclasses). New exception types need **no** new branch here. |
| 5 | `Prisma.PrismaClientKnownRequestError` | `Error` | `PrismaClientKnownRequestError extends Error`. Must be mapped before the generic dev-only `Error` fallback. |
| 6 | `Error` (dev only) | — | Last resort. In production this branch is skipped entirely and the response stays a generic 500. |

> **When adding a branch:** insert it *above* every class it is a subclass of. If you're unsure, check with `node -e "console.log(new Sub() instanceof Parent)"`. A subclass placed below its parent produces no compile error and no test failure — it just silently never runs.

---

## 5. Authentication errors — the `errorCode` contract

### 5.1 The problem this solves

`passport-jwt` reports *why* authentication failed through an `info` argument that carries library-internal strings: `"No auth token"`, `"jwt expired"`, `"invalid signature"`, `"jwt malformed"`. Passing those through to clients is wrong on three counts:

1. **Not user-facing.** "No auth token" means nothing to a normal user; "Please log in to continue." does.
2. **Not a stable contract.** These strings come from `jsonwebtoken`'s internals. A patch-level dependency bump can reword them and silently break any client matching on them.
3. **Not actionable.** All four arrive as an untyped 401, so the client cannot tell "refresh the token" from "the token is forged, wipe the session" without string-matching English.

### 5.2 The mapping

`mapAuthError()` in `src/modules/auth/guards/jwt-auth.guard.ts` is the single translation point.

| Cause | `errorCode` | `message` | What the client should do |
|---|---|---|---|
| No `Authorization` header / cookie | `AUTH_TOKEN_MISSING` | Please log in to continue. | Redirect to login. Do **not** attempt a refresh. |
| `exp` in the past | `AUTH_TOKEN_EXPIRED` | Your session has expired. Please log in again. | **Attempt a silent refresh**, retry the original request once, and only log out if the refresh also fails. |
| Bad signature / malformed / `nbf` in the future | `AUTH_TOKEN_INVALID` | Your session is invalid. Please log in again. | Hard logout — clear storage/cookies immediately. The credential is untrustworthy. |
| Anything else | `AUTH_UNAUTHORIZED` | Authentication failed. Please log in again. | Treat as a hard logout. |

The mapping **matches on `error.name` before `error.message`**:

```ts
const name = info instanceof Error ? info.name : '';
if (name === 'TokenExpiredError') { /* ... */ }
if (name === 'JsonWebTokenError' || name === 'NotBeforeError') { /* ... */ }
if (raw === 'No auth token') { /* ... */ }
```

`jsonwebtoken` keeps its exported class *names* stable across releases but rewords the *messages*. Matching on the name is therefore the durable choice. `"No auth token"` is the one case with no class to match on — passport reports a missing credential with a plain `Error` — so it remains a string comparison, and falls through to `AUTH_UNAUTHORIZED` if that string ever changes. Degrading to a vaguer-but-correct code is an acceptable failure mode; reporting a *wrong* code is not.

### 5.3 The two rethrow rules in the guard

Both exist to stop a correct exception from being destroyed on its way out. They are easy to "clean up" and thereby reintroduce the bug:

```ts
//* IN canActivate's catch
if (err instanceof HttpException) {
  throw err;
}
```
`handleRequest` has already thrown a fully-shaped `UnauthorizedException` carrying `errorCode`. The previous code re-wrapped it as `new UnauthorizedException(err.message)`, which flattened the object payload back to a bare string and **discarded the code**. Anything that is already a proper `HttpException` must pass through untouched.

```ts
//* IN handleRequest, before mapping
if (err instanceof HttpException) {
  throw err;
}
```
The `err` argument is populated when `JwtStrategy.validate()` rejects deliberately — "account disabled", "user not found". That message is already domain-specific and user-appropriate; overwriting it with a generic auth message would lose real information.

### 5.4 Known gap — the refresh endpoint

`AuthService.refreshToken()` wraps its whole body in `try/catch` and rethrows a single `UnauthorizedException('Invalid or expired refresh token')` for every failure. That message is user-safe, but it collapses expired-vs-forged into one string and carries **no `errorCode`**. Refresh tokens are the one place where that distinction has real security value (a forged refresh token is a signal worth logging and possibly alerting on). Adding `AUTH_REFRESH_EXPIRED` / `AUTH_REFRESH_INVALID` there is the natural next increment.

---

## 6. Authorization (403) vs. authentication (401)

A distinction that is wrong in a surprising number of production APIs:

- **401 Unauthorized** — *"I don't know who you are."* No credential, or an unusable one. The client's job is to obtain a credential. Produced by `JwtAuthGuard`.
- **403 Forbidden** — *"I know exactly who you are, and you still can't."* Produced by `RolesGuard`. **Retrying with a fresh token will not help**, which is precisely why the codes must differ: a client that treats 403 as 401 will spin in a refresh-then-retry loop forever.

`RolesGuard` currently throws three distinct `ForbiddenException` messages (`User session not found`, `User role is missing or invalid`, `Insufficient role privileges`). These are honest but leak a little internal state and carry no `errorCode` — a candidate for the same treatment as §5 (`AUTHZ_INSUFFICIENT_ROLE`).

---

## 7. Validation errors — what actually comes out

`main.ts` configures a global `ValidationPipe`:

```ts
new ValidationPipe({
  whitelist: true,              // strips properties not on the DTO
  forbidNonWhitelisted: true,   // ...and 400s if any were sent
  transform: true,              // plain JSON → DTO class instance
})
```

`forbidNonWhitelisted` is the strict choice and the right one: a typo'd field name (`{ prodcutId: 14 }`) fails loudly at the boundary instead of being silently dropped and surfacing later as a mysterious null.

**The actual payload shape.** Nest's default `exceptionFactory` flattens `ValidationError` objects into a plain array of constraint strings *before* constructing the exception:

```jsonc
// exception.getResponse() for a failed DTO
{ "message": ["email must be an email", "price must not be less than 0"],
  "error": "Bad Request", "statusCode": 400 }
```

So the filter's `BadRequestException` branch takes its `else` path, and validation failures reach the client with **`message` as a `string[]`, one entry per violated constraint**:

```jsonc
{
  "statusCode": 400, "success": false,
  "message": ["email must be an email", "price must not be less than 0"],
  "error": "Bad Request",
  "timestamp": "2026-07-27T05:01:50.299Z"
}
```

This is genuinely useful — the client can render one line per problem — but **clients must handle `message` being either a string or an array**. That is why `IApiResponse`-adjacent typings and every consumer should treat it as `string | string[]`.

The branch above it — the one testing `validationErrors.message[0] instanceof ValidationError` and calling `constraintRecordFromUnknown()` — only fires if a **custom `exceptionFactory`** passes raw `ValidationError` instances through instead. No such factory is registered today, so that branch is currently inactive. It is retained deliberately: it is the hook for upgrading to field-keyed errors (see §11.3) without touching the filter.

---

## 8. Prisma error mapping

`mapPrismaError()` translates the small set of Prisma codes that represent a **client mistake** into an actionable 4xx. Everything else is treated as a server bug.

| Prisma code | Meaning | HTTP | Client message |
|---|---|---|---|
| `P2002` | Unique constraint violated | 409 | `A record with this <fields> already exists` |
| `P2025` | Record required by the operation not found | 404 | `The requested record was not found` |
| `P2003` | Foreign key constraint failed | 400 | `This action references a record that does not exist` |
| `P2000` | Value too long for column | 400 | `One of the provided values is too long for its field` |
| *(anything else)* | Schema drift, connection failure, bad query | 500 | Generic (real text in dev only) |

The `P2002` handler deals with a genuine cross-provider inconsistency: `exception.meta.target` is an **array of column names** on some providers and a **single constraint-name string** (e.g. `product_variants_sku_key`) on others. Both are surfaced so the 409 always names the colliding field.

**The unmapped-code default is the important design decision.** `P2021` ("table does not exist") is a migration-drift bug, not something a client can fix. Returning 400 for it would tell the frontend to show a form error for an outage. Falling through to 500 gets it logged with a stack trace and paged — the correct outcome.

---

## 9. The production disclosure boundary

```ts
private readonly isProduction = process.env.NODE_ENV === 'production';
```

Two branches are gated on this, and both matter:

| | Development | Production |
|---|---|---|
| Unmapped Prisma error | Last line of the Prisma message + `Database Error (P2014)` | `Internal server error` |
| Any other unhandled `Error` | `exception.message` + `exception.name` | `Internal server error` |

Why gate rather than always-hide: an unmapped 500 in local development otherwise costs a round trip to the log file for every iteration. Why gate rather than always-show: Prisma error text contains **table names, column names, and constraint identifiers** — a free schema map for an attacker probing endpoints.

The information is never lost, only relocated: every `statusCode >= 500` is logged with its full stack trace *before* the sanitized response is written.

> **Verify `NODE_ENV=production` is actually set in your deployment.** This is a plain `process.env` read at construction time, not a validated config value. If it is unset in prod, the app silently runs in disclosure mode. This is the single highest-value thing to check on a new environment.

---

## 10. Logging & correlation

```ts
if ((statusCode as number) >= 500) {
  this.logger.error(`Unhandled Exception [${statusCode}]: ${logMessage}`, stack);
}
```

**Only 5xx is logged, deliberately.** 4xx responses are expected client behavior — a wrong password, a validation failure, an expired token. Logging them at `error` level trains everyone to ignore the error log, which is how real incidents get missed. They are still visible: `LoggingInterceptor` emits exactly one access-log line per request with its final status code.

Because `GlobalExceptionFilter` uses a standard `new Logger(...)` and the whole request runs inside the `AsyncLocalStorage` scope opened by `RequestContextMiddleware`, every error line is **automatically stamped with `correlationId`, `userId`, and `role`** by the winston format pipeline — no plumbing at the throw site. See `docs/concepts/logger.md` §2.1.

The same correlation ID is returned on the `x-correlation-id` response header. **Surface it in client-side error UI** ("Reference: `a1b2c3…`"); a user-reported bug then becomes a single log query instead of a guess.

> **Gap:** `correlationId` is on the response *header* but not in the error *body*. Putting it in the body would make it trivially available to any client that already parses the envelope. Low-cost, high-value addition.

---

## 11. How to throw — rules for feature code

### 11.1 The decision table

| Situation | Throw | Status |
|---|---|---|
| Caller sent something structurally wrong | `BadRequestException` | 400 |
| No/unusable credential | *nothing* — `JwtAuthGuard` handles it | 401 |
| Known user, insufficient rights | `ForbiddenException` | 403 |
| Target row genuinely doesn't exist | `NotFoundException` | 404 |
| Conflicts with existing state | `ConflictException` | 409 |
| Valid shape, violates a business rule | `UnprocessableEntityException` | 422 |
| A genuine bug | *nothing* — let it propagate | 500 |

### 11.2 Rules

1. **Never `return` an error.** `return { success: false }` is wrapped by `ResponseInterceptor` into a **200 OK**. The status code becomes a lie and every client treats the failure as success. Throw.
2. **Never `catch` just to rethrow the same thing.** It adds a frame and destroys the stack. Catch only to *add* information or to *translate* a foreign error type.
3. **Never catch broadly around a whole method.** `AuthService.refreshToken()` (§5.4) shows the cost: an unrelated bug inside that `try` — a `TypeError` in `getUserById` — is reported to the user as "Invalid or expired refresh token" and, because it becomes a 401, **is never logged**. Wrap the single call that can fail, not the method.
4. **Every message you write is user-facing.** Assume it will be rendered verbatim in a toast. `"Cannot delete a user who still owns 3 posts"` — good. `"FK violation on author_id"` — never.
5. **Don't build the envelope.** No `res.status(...).json(...)` in a controller. If you need a header, use `@Header()`; if you need a status, use `@HttpCode()`.

### 11.3 Adding an `errorCode` to a new failure

The filter's generic `HttpException` branch already reads `errorCode` from any object payload, so **no filter change is needed**:

```ts
throw new ConflictException({
  message: 'This SKU is already used by another variant.',
  error: 'Conflict',
  errorCode: 'BLOG_SLUG_DUPLICATE',
});
```

Conventions: `<DOMAIN>_<CONDITION>`, `SCREAMING_SNAKE_CASE`, and **frozen once shipped** — a published code is API surface. To change its meaning, add a new code and deprecate the old one. Domain prefixes in use: `AUTH_`. Natural next ones: `AUTHZ_`, `INVENTORY_`, `PRODUCT_`, `ORDER_`.

For a domain with more than a couple of codes, promote the union type out of the guard into `src/common/errors/error-codes.ts` and export it so the frontend can generate its own types from it.

---

## 12. Client integration

```ts
type ApiError = {
  statusCode: number;
  success: false;
  message: string | string[];   // ← ALWAYS handle both
  error: string;
  errorCode?: string;           // ← optional; branch on this, never on `message`
  timestamp: string;
};

// Axios/fetch interceptor sketch
switch (err.errorCode) {
  case 'AUTH_TOKEN_EXPIRED':
    return refreshThenRetryOnce(originalRequest);   // silent recovery
  case 'AUTH_TOKEN_INVALID':
  case 'AUTH_UNAUTHORIZED':
    return hardLogout();                            // clear storage, no retry
  case 'AUTH_TOKEN_MISSING':
    return redirectToLogin();                       // no refresh attempt
  default:
    return toast(Array.isArray(err.message) ? err.message.join('\n') : err.message);
}
```

Three rules for the client side:

1. **Branch on `errorCode` first, `statusCode` second, `message` never.**
2. **Retry only `AUTH_TOKEN_EXPIRED`, and only once.** Retrying `AUTH_TOKEN_INVALID` is an infinite loop.
3. **Never retry a 403.** Different token, same answer.

---

## 13. Known gaps

Recorded honestly so they're chosen deliberately, not discovered during an incident.

| Gap | Impact | Fix |
|---|---|---|
| `errorCode` exists only for auth failures | Client string-matches for every other domain condition | Roll out per §11.3, highest-traffic paths first |
| `correlationId` not in the error body | Support has to ask users for a response header | One line in the filter's `.json({...})` |
| `AuthService.refreshToken()` collapses all failures | No expired-vs-forged signal on the refresh path | §5.4 |
| `RolesGuard` messages leak internal state, no code | Minor disclosure; client can't distinguish 403 causes | §6 |
| The `-office` server keeps a **separate copy** of the filter and guard | The two drift; this fix had to be applied twice | Extract to a shared package, or accept and diff on every change |
| Filter is `new`-instantiated, so no DI | Can't inject `ConfigService`; reads `process.env` directly | Re-register via `APP_FILTER` when a dependency is first needed |
| Not RFC 9457 (`application/problem+json`) | Non-standard to external integrators | Only worth it if third parties consume this API |
| Messages are hardcoded English | No localization of errors | `errorCode` is the enabler — the client can map code → localized string today, which is the better architecture anyway |
| Messages are not machine-parseable beyond `errorCode` | Clients that need the *values* behind a message must parse prose | The 429 path shows the alternative — it ships `retryAfter` as a number alongside the sentence (see [`rate-limiting.md`](./rate-limiting.md) §2.9) |

---

## 14. Testing

What is worth asserting, in rough priority order:

1. **Envelope shape** — one e2e test per status class (400/401/403/404/409/500) asserting all keys are present and correctly typed.
2. **`errorCode` for each auth path** — no token / expired token / tampered signature. These are the codes clients branch on; a regression here logs users out incorrectly.
3. **The rethrow rules (§5.3)** — a unit test that `canActivate` preserves `errorCode` when `handleRequest` throws. This is the exact bug that existed before; it's invisible without a test.
4. **Branch order (§4)** — assert a `TokenExpiredError` yields `AUTH_TOKEN_EXPIRED`, not `AUTH_TOKEN_INVALID`. Subclass-ordering bugs produce no compile error and no runtime error.
5. **Production disclosure** — with `NODE_ENV=production`, an unmapped Prisma error must return exactly `Internal server error` and must not contain any table name.
6. **Prisma mapping** — one case per mapped code, plus one unmapped code asserting a 500.

---

## 15. Quick reference

```
throw new NotFoundException('Blog not found')
        │
        ▼
GlobalExceptionFilter  →  { statusCode, success:false, message, error, errorCode?, timestamp }
        │
        └─ 5xx only → logger.error(msg, stack) with correlationId
```

- **Add a status?** Throw the matching built-in `HttpException`. No filter change.
- **Add an `errorCode`?** Pass an object payload. No filter change.
- **Add an error *class*?** Insert the branch **above** every class it extends (§4).
- **Add a Prisma code?** One `case` in `mapPrismaError()` — and only if a client can act on it.
