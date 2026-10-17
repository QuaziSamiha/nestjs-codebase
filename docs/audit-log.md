# Audit Log Module

A generic, append-only change-history table — one `AuditLog` row per `create`/`update`/`upsert`/`delete` against an allowlisted set of models, capturing who changed what, when, and the field-level before/after diff. It replaces the need for every mutable model to grow its own `createdBy`/`updatedBy`/`deletedBy` relation trio back to `User`: an ownership FK (like `Blog.authorId`) answers "who currently owns this row" cheaply; `AuditLog` answers "what actually happened to it over time," which such a column cannot.

Module source: `src/modules/audit-log/` (`audit-log.controller.ts`, `.service.ts`, `.repository.ts`, `.module.ts`, `dto/`). The write side lives outside this module, in `src/prisma/extensions/audit-log.extension.ts` — see [How Rows Get Written](#how-rows-get-written) for why.

---

### Data Dictionary — `AuditLog`

Schema source: `prisma/schema/audit-log.prisma`, table `audit_logs`.

| Field        | Type             | Constraints                                              | Description                                                                 |
| :----------- | :--------------- | :-------------------------------------------------------- | :---------------------------------------------------------------------------- |
| `id`         | `INT`            | PK, AUTOINCREMENT                                          | Internal key.                                                               |
| `actorId`    | `INT`            | NULLABLE, FK → `users.id`, **ON DELETE SET NULL**          | The authenticated user who made the change. `NULL` if the mutation ran with no request-scoped user (see [Known Gaps](#known-gaps--recommended-hardening)) or if that user's row was later deleted — audit history must outlive the actor. |
| `entityType` | `TEXT`           | NOT NULL                                                   | The Prisma model name (e.g. `"Blog"`), **not** a DB enum — see [Why `entityType` Is a Plain String](#why-entitytype-is-a-plain-string). |
| `entityId`   | `INT`            | NOT NULL                                                   | The changed row's `id` in its own table.                                    |
| `action`     | `ENUM(AuditAction)` | NOT NULL                                                | `CREATE`, `UPDATE`, `SOFT_DELETE`, `DELETE` — see [Action Semantics](#action-semantics). |
| `diff`       | `JSONB`          | NULLABLE                                                   | `{ before?, after? }`, each holding only the fields that actually changed. See [Diff Shape](#diff-shape). |
| `createdAt`  | `TIMESTAMPTZ(3)` | NOT NULL, DEFAULT `now()`                                  | When the change was recorded — effectively the change timestamp itself.     |

Indexes: `(entityType, entityId)` (the "show this row's history" query), `(actorId)`, `(createdAt)`.

No `sid` (public-safe UUID) field, unlike most models in this codebase — `AuditLog` rows are never linked to by a public URL, only listed/filtered by an admin through `GET /audit-log`, so the usual public-safe-id convention doesn't apply.

---

### How Rows Get Written

A [Prisma Client Extension](https://www.prisma.io/docs/orm/prisma-client/client-extensions) (`createAuditLogExtension`, `src/prisma/extensions/audit-log.extension.ts`) intercepts every Prisma operation via `query.$allModels.$allOperations`, and for models in `TRACKED_AUDIT_MODELS`:

- **`create`** → run the query, then write `{ action: CREATE, diff: { after: <redacted result> } }`.
- **`update` / `upsert`** → `findUnique` the row first (using the caller's own `where`/`select`/`include`, so before/after have matching shapes), run the query, diff only the fields that changed. If `deletedAt` transitioned `null` → non-`null`, the action is `SOFT_DELETE`; otherwise `UPDATE`. **If nothing actually changed (a no-op update), no row is written at all.**
- **`delete`** → `findUnique` first (there's no "after"), run the query, write `{ action: DELETE, diff: { before: <redacted row> } }`.
- Any other operation (`findMany`, `count`, ...), or any model not in the allowlist, passes straight through untouched — including the `AuditLog` model itself, which is never tracked (prevents the hook from recursing into its own write).
- **Bulk operations (`updateMany`/`deleteMany`/`createMany`) are not diffed per-row.** They pass through untouched. This is a deliberate scope limit, not a silent gap — see [Known Gaps](#known-gaps--recommended-hardening).

**Wiring.** Every repository in this codebase (18 files) injects `PrismaService` directly and calls `super(prisma)` from `BaseRepository`. Rather than introduce a second client type/token that all 18 constructors would need to switch to, `PrismaModule` overrides what the `PrismaService` **token** resolves to:

```ts
// src/prisma/prisma.module.ts
{
  provide: PrismaService,
  useFactory: (configService, requestContext) => {
    const base = new PrismaService(configService);
    return base.$extends(createAuditLogExtension(requestContext)) as unknown as PrismaService;
  },
  inject: [ConfigService, RequestContextService],
}
```

Every existing repository keeps injecting `PrismaService` completely unchanged and transparently receives the extended client. The one place this mattered: `PrismaService` used to implement `OnModuleInit`/`OnModuleDestroy` itself to call `$connect`/`$disconnect`. `.$extends()` only guarantees **core** `PrismaClient` methods survive (`$connect`, `$disconnect`, `$transaction`, model delegates, ...) — not arbitrary custom subclass methods. So that lifecycle moved to `PrismaModule` itself (`OnApplicationBootstrap`/`OnApplicationShutdown`, calling `$connect`/`$disconnect` on the injected — already-extended — instance, both of which are core methods).

**Actor identity — no new plumbing needed.** `RequestContextService` (`src/shared/logger/request-context.service.ts`) already wraps `AsyncLocalStorage` and already carries the authenticated `userId` for the lifetime of a request; it's populated by the globally-registered `LoggingInterceptor` right after guards resolve `request.user`, and interceptors run before the route handler. So by the time any service/repository code executes, `requestContext.get('userId')` reliably reflects the current actor — the extension just reads it, exactly like the logging pipeline already does.

**Not transactionally atomic — a deliberate, verified deviation from the original design.** The natural design would read `this` inside `$allOperations` to reach sibling models (`this.auditLog.create(...)`), which — on an *engine-based* Prisma client — resolves to whatever client the operation is actually running on, including the interactive-transaction client inside `BaseRepository.withTransaction()`. **This does not hold on Prisma 7.7.0's newer client** (`@prisma/client/runtime/client`, the "no separate query engine" architecture this project uses): empirically verified against a real database that `this` inside the hook is *not* the extended client and exposes no model delegates at all. `Prisma.getExtensionContext(this)` was also tried and doesn't help — it's for `client`/`model` extension components, not `query`. The working fix, used here: `Prisma.defineExtension` takes a factory callback whose return value (the extended client) is captured into a closure variable the moment `.$extends()` runs, and every hook invocation uses that captured reference for the cross-model audit write. This works reliably, but that captured client is always the *top-level* one — so the audit write runs on its own pooled connection, outside whatever transaction the mutation itself is part of. **Practical effect:** if a mutation runs inside `BaseRepository.withTransaction()` and something *later* in that same transaction fails, the transaction rolls back the mutation but the audit row already written for it does not get rolled back with it — an audit entry can end up describing a change that was ultimately undone. This is a known, accepted limitation, not a silent one.

---

### Tracked Models

`TRACKED_AUDIT_MODELS` (`src/prisma/extensions/audit-log.extension.ts`, also re-exported for the query DTO's `entityType` filter — one list, not two that can drift):

```
Blog
```

The template ships tracking `Blog` only. **Keep out** any model that is already its own append-only change log (e.g. a status-history table with one row per transition, `changedBy` + a timestamp) — running generic audit on top of it would just duplicate what it already records. `User` is deliberately not tracked by default: login metadata updates (`lastLoginAt`, login attempts) would flood the table — add it if you want role/status changes audited, ideally with a filter.

Tracking a new model going forward is a **one-line, code-only change** — add its name to this array. No schema change, no migration. This is the concrete payoff of `entityType` being a plain string instead of a DB enum, and of `User` needing exactly one `auditLogs` back-relation total instead of a new `createdBy`/`updatedBy` pair per table.

---

### Action Semantics

| Action        | When                                                                 |
| :------------ | :--------------------------------------------------------------------- |
| `CREATE`      | A new row was inserted.                                                |
| `UPDATE`      | An existing row changed, and `deletedAt` did not transition `null` → non-`null`. |
| `SOFT_DELETE` | An `update` whose `deletedAt` went from `null` to non-`null` (only meaningful for tracked models that have a `deletedAt` column). |
| `DELETE`      | A real Prisma `delete` — a hard row removal.                           |

---

### Diff Shape

`diff` is `{ before?: Record<string, unknown>; after?: Record<string, unknown> }`, computed as a **shallow, changed-fields-only** comparison — unchanged columns never appear, so a row stays small and the interesting part isn't buried in the columns that didn't move.

- `CREATE` → `{ after: <full created row> }` (no `before`).
- `DELETE` → `{ before: <full row as it existed> }` (no `after`).
- `UPDATE` / `SOFT_DELETE` → `{ before: {...changedFieldsOnly}, after: {...changedFieldsOnly} }`.

Before writing, both `before` and `after` are passed through the existing `redactSensitiveFields` utility (`src/shared/logger/utils/redact.util.ts`, the same one the logging pipeline uses) with `DEFAULT_REDACTED_KEYS` (`password`, `token`, `refreshToken`, `secret`, ...). The currently tracked models hold no credential-shaped fields, but the diff logic doesn't special-case per model — this is cheap insurance against a future field addition leaking into a diff unnoticed.

---

### Endpoint

**`GET /api/v1/audit-log`** — `AuditLogController`, admin only (`@Roles(UserRole.ADMIN)`, same `JwtAuthGuard`/`RolesGuard` pair every other admin list route uses).

Query params (`AuditLogQueryDto`, extends the shared `PaginationQueryDto`): `entityType` (whitelisted to `TRACKED_AUDIT_MODELS`), `entityId`, `actorId`, `action`, `from`/`to` (createdAt range), plus the usual `page`/`limit`/`sortOrder`/`cursor`. Default sort is `createdAt desc` — newest first. Combining `entityType` + `entityId` scopes to one record's full history (e.g. every recorded change to `Blog #42`).

Response is the standard paginated envelope (`{ data: AuditLogResponseDto[], meta }`); each row's `actor` is the same `UserMinifiedResponseDto` shape used elsewhere (`id`, `name`, `email`, `role`, `status`), included via a single join so the admin UI never needs a second round-trip for a display name.

---

### Why `entityType` Is a Plain String

An enum would mean a schema migration every time a new model starts being tracked — directly contradicting the reason this table exists (the known-gaps note this module answers: "every new table needs 2-3 new relation fields on `User`... doesn't scale"). Keeping `entityType` a free-form string and the allowlist in code (`TRACKED_AUDIT_MODELS`) means adding audit coverage for another model is a one-line array edit, never a migration.

---

### Known Gaps / Recommended Hardening

- **Audit writes are not atomic with the transaction they describe** — see [How Rows Get Written](#how-rows-get-written). A mutation inside `BaseRepository.withTransaction()` that later rolls back for an unrelated reason can leave behind an `AuditLog` row for a change that never actually persisted. Fixing this would need either a Prisma version/client architecture where `this` inside `$allOperations` is genuinely transaction-aware, or falling back to explicit `tx` threading per call site — the exact per-repository boilerplate this module exists to avoid.
- **Bulk operations aren't diffed per-row.** `updateMany`/`deleteMany`/`createMany` on a tracked model pass through the extension untouched — no `AuditLog` row is written at all for them. None of the tracked models' services currently perform bulk writes in a way that matters for audit purposes, but if one starts to, this module won't notice.
- **`actorId` is `NULL` for any mutation with no authenticated request context** — e.g. anything invoked outside an HTTP request (a seed script, a cron job, a console repl against `PrismaService` directly). There's no distinction in the data between "no actor because the route is genuinely public" and "no actor because this ran outside a request entirely."
- **No retention/archival policy.** This table is purely additive and grows forever; nothing here prunes or archives old rows.
- **Audit history is not a substitute for an ownership column.** If you need a cheap, indexed "who owns this row" lookup (e.g. `Blog.authorId`), keep a real FK for it — a change-history table isn't optimized to answer that.
