# Prisma ORM — Concepts & Developer Guide

This document covers **what Prisma features this codebase actually uses, how, and why** — the patterns to follow when you write new repository code. For the file map see [Architecture](../architecture/prisma.md); for CLI commands see [Commands](../commands/prisma.md).

> Scope note: only the things genuinely used (or deliberately scaffolded) in this repo are documented here. This is not a general Prisma reference — see the [official docs](https://www.prisma.io/docs) for anything not covered below.

---

## Env file precedence

Both loading paths resolve files in this order (first file to define a variable wins; later files only fill in what's missing):

```
1. .env.<NODE_ENV>.local   (e.g. .env.development.local — personal, gitignored, never shared)
2. .env.<NODE_ENV>         (e.g. .env.development — shared team defaults)
3. .env                    (fallback / generic)
```

`NODE_ENV` defaults to `development` if unset. This means running any bare `npx prisma ...` command now correctly picks up `.env.development.local` without needing the `dotenv-cli` wrapper.

---

## `PrismaService` — driver adapter, pooling, lifecycle

`src/prisma/prisma.service.ts` extends the generated `PrismaClient` directly (class inheritance, not `$extends`) so every repository gets full IntelliSense on `this.prisma.<model>.<method>`.

```ts
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    const pool = new Pool({
      connectionString: configService.get<string>('database.url'),
      max: configService.get<number>('database.pool.max'),
      idleTimeoutMillis: configService.get<number>('database.pool.idleTimeoutMillis'),
      connectionTimeoutMillis: configService.get<number>('database.pool.connectionTimeoutMillis'),
    });
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });
    super({ adapter });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

- **Driver adapter, not the legacy query engine binary** — `@prisma/adapter-pg` lets Prisma run on top of a `pg.Pool` we control directly, instead of Prisma managing its own connection pool internally.
- **Pool sizing is env-driven**, not hardcoded — `DATABASE_POOL_MAX` / `DATABASE_POOL_IDLE_TIMEOUT_MS` / `DATABASE_POOL_CONNECTION_TIMEOUT_MS` (all optional, default to `pg`'s own defaults: `10` / `10000` / `0`). Set them per-environment in `.env.production` etc. when you need to tune for load — see `src/prisma/config/database.config.ts`.
- **`disposeExternalPool: true` is load-bearing.** Without it, `$disconnect()` on shutdown closes the Prisma engine but leaves the underlying `pg.Pool`'s TCP connections open — a connection leak on every restart/redeploy.
- Lifecycle hooks (`OnModuleInit` / `OnModuleDestroy`) connect/disconnect the pool with the NestJS app lifecycle, so a graceful shutdown actually closes DB connections.

---

## Repositories, `BaseRepository`, and transactions

Every repository extends `src/prisma/base.repository.ts`:

```ts
export abstract class BaseRepository {
  constructor(protected readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(tx as Prisma.TransactionClient));
  }
}
```

Two conventions work together here — **don't use one without the other**:

1. **Every repository method accepts an optional `tx?: Prisma.TransactionClient`** and falls back to `this.prisma` when absent:
   ```ts
   async findById(id: number, tx?: Prisma.TransactionClient) {
     const client = tx || this.prisma;
     return await client.blog.findUnique({ where: { id }, select: BLOG_SELECT_ADMIN });
   }
   ```
   (`src/modules/blog/blog.repository.ts`)

2. **`withTransaction` is called from the *service* layer**, not from inside the repository — a service is what knows it needs several repositories to commit atomically. Real example, `UserService.registerUser` (`src/modules/user/user.service.ts`):
   ```ts
   return await this.userRepo.withTransaction(async (tx) => {
     const user = await this.userRepo.createUser({ ...userData, password: hashedPassword }, tx);
     await this.profileRepo.createUserProfile({ ...profile, userId: user.id }, tx);
     await this.securityRepo.createUserSecurity({ userId: user.id, ... }, tx);
     // ...
   });
   ```
   If any step throws, Prisma rolls back the whole interactive transaction.

**Only the interactive-callback form (`$transaction(fn)`) is used in this codebase.** The batch-array form (`$transaction([query1, query2])`) doesn't appear anywhere — prefer the callback form for consistency unless you have a specific reason to batch independent writes.

---

## Relation loading — `select`, never `include`

This codebase uses `select` (with nested `select` blocks for relations) exclusively. `include` is never used in app code — only `select`, so every query has an explicit, intentional field list instead of pulling whole relations by default.

```ts
private readonly PROFILE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  // ...
} as const;

private readonly FULL_USER_SELECT_SELF = {
  ...USER_SELECT,
  profile: { select: this.PROFILE_SELECT },
  security: { select: this.SECURITY_SELECT_SELF },
} as const;
```
(`src/modules/user/repositories/user.repository.ts` — the blog module keeps its selects in a sibling `blog.select.ts` file instead, which works equally well)

**Convention for new repositories:** define one or more `private readonly X_SELECT = { ... } as const` class fields and reuse them across the repository's methods — don't inline a fresh select object in every method. Use multiple named selects when different endpoints need different shapes (see `FULL_USER_SELECT_SELF` vs `FULL_USER_SELECT_ADMIN` vs flat `USER_SELECT` in `src/modules/user/repositories/user.repository.ts`).

---

## `Prisma.*` namespace types in use

| Type | Used for | Example |
|---|---|---|
| `Prisma.TransactionClient` | The `tx` parameter type on every repository method | all repositories |
| `Prisma.<Model>CreateInput` | `create()` payload when you'll connect relations explicitly (e.g. `parent: { connect: { id } }`) | `Prisma.BlogCreateInput` in `blog.repository.ts` |
| `Prisma.<Model>UncheckedCreateInput` | `create()` payload when you set the foreign key scalar directly (e.g. `userId: 1`) instead of a relation `connect` | `Prisma.ProfileUncheckedCreateInput`, `Prisma.UserSecurityUncheckedCreateInput`, `Prisma.OTPUncheckedCreateInput` |

**Rule of thumb:** if the FK column lives on *this* model and you already have the parent's primary key (e.g. creating a `Profile` right after creating its `User`), use the `Unchecked` variant and set the scalar FK directly — it's simpler than the relation `connect` syntax and saves a check Prisma would otherwise do. Use the relation `connect` form (non-`Unchecked`) when the FK is optional/nullable and conditionally set, or when expressing intent ("connect to an existing author") reads clearer than a bare ID assignment.

`Prisma.<Model>GetPayload` types every `paginate<T, …>()` call, and `$extends` is used once — by the audit-log client extension (`src/prisma/extensions/audit-log.extension.ts`). Not used anywhere in this codebase: `Prisma.validator`, `Prisma.<Model>Include`, `$use` (middleware). If you reach for one of these, you're doing something this codebase hasn't needed yet — make sure there isn't a `select`-based way to do it first.

---

## Enums

All enums are generated from `prisma/schema/*.prisma` into `src/generated/prisma/enums.ts`.

| Enum | Defined in | Import from |
|---|---|---|
| `UserRole` | `user.prisma` | `../../generated/prisma/enums` |
| `AuthProvider` | `user.prisma` | `../../generated/prisma/enums` |
| `UserStatus` | `user.prisma` | `../../generated/prisma/enums` |
| `OTPType` | `user.prisma` | `../../generated/prisma/enums` |
| `BlogStatus` | `blog.prisma` | `../../generated/prisma/enums` |
| `AuditAction` | `audit-log.prisma` | `../../generated/prisma/enums` |

> ⚠️ **Gotcha — pick one import path and stick to it.** `src/modules/user/repositories/user.repository.ts` imports `UserStatus` from `'../../../generated/prisma/client'` instead of `'../../../generated/prisma/enums'`. Both re-export the same enum, so it isn't a bug, but it's an inconsistency — **always import enums from `generated/prisma/enums`**, never from `generated/prisma/client`, so a future refactor of the client barrel doesn't silently break enum imports.

---

## Pagination

Shared, model-agnostic pagination lives in `src/shared/pagination/`, not duplicated per module.

```ts
// pagination.interface.ts
export interface IPaginationMeta {
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  totalPages: number;
  currentPage: number;
}
export interface IPaginatedResult<T> {
  data: T[];
  meta: IPaginationMeta;
}
// Structural type any Prisma model delegate satisfies — lets PaginationService
// stay generic without importing every model's concrete delegate type.
export type TPrismaModelDelegate<T> = {
  count: (args: { where?: any }) => Promise<number>;
  findMany: (args: { where?: any; select?: any; take?: number; skip?: number; orderBy?: any }) => Promise<T[]>;
};
```

`PaginationService.paginate(model, params, options)` (`src/shared/pagination/pagination.service.ts`) runs `count` and `findMany` in parallel via `Promise.all`, applies `skip`/`take` (offset pagination — **no cursor-based pagination exists in this codebase**), and builds the `meta` block. It also builds an `OR`-based case-insensitive search condition across `options.searchableFields`, including dotted paths for nested relation search (e.g. `'profile.name'`).

Usage — pass the Prisma delegate straight through, plus your `select` and searchable fields:
```ts
async findAllBlogsAdmin(params: PaginationQueryDto, tx?: Prisma.TransactionClient) {
  const client = tx || this.prisma;
  return await this.paginationService.paginate(client.blog, params, {
    select: BLOG_SELECT_ADMIN,
    searchableFields: ['title', 'slug'],
    defaultSortField: 'createdAt',
  });
}
```
Used today by `blog.repository.ts` (`findAllBlogsAdmin`, `findAllPublishedBlogs`), `user.repository.ts` (`findAllUsers`) and `audit-log.repository.ts`. `PaginationQueryDto` lives in `src/shared/pagination/dto/pagination-query.dto.ts`. See [pagination-concepts.md](./pagination-concepts.md) for the full contract, including cursor mode.

---

## Soft delete

`User.deletedAt` is a soft-delete column. Every email lookup in `UserRepository` filters `deletedAt: null`, `JwtStrategy` rejects a token whose user has it set, and the email-uniqueness index is partial on `deleted_at IS NULL` (so a soft-deleted account's email can be re-registered). The `deactivate-user` route sets `status = DEACTIVATED` rather than stamping `deletedAt`.

**If you add soft delete to another model:** every `findMany`/`findUnique`/`findFirst` against it must filter `deletedAt: null` (or use a shared `where` helper), and "deleting" must be an `update({ data: { deletedAt: new Date() } })`, never `.delete()`. The audit-log extension records a null → non-null `deletedAt` transition as `SOFT_DELETE` automatically for tracked models.

---
## Error handling — current state and recommended pattern

No repository or service in this codebase currently catches `Prisma.PrismaClientKnownRequestError` or checks Prisma error codes (`P2002` unique violation, `P2025` record not found, etc.). Errors thrown today are domain-level NestJS exceptions raised *before* the Prisma call, after an explicit business-logic check (e.g. `ConflictException('Email already registered')` after an existence check in `user.service.ts`).

This works while every uniqueness/existence check is done with an extra read first, but it's a gap once code starts relying on the database to enforce a constraint (e.g. a race on a unique `slug`). **Recommended pattern for new code**, don't invent your own shape:
```ts
import { Prisma } from '../../generated/prisma/client';

try {
  return await this.prisma.blog.create({ data, select: BLOG_SELECT_ADMIN });
} catch (err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictException('Slug already in use');
  }
  throw err;
}
```

---

## Testing code that depends on `PrismaService`

Two infrastructure pitfalls block tests that touch `PrismaService`, both already fixed in this repo — know about them before writing a new spec:

1. **ts-jest can't resolve the generated client's ESM-style `.js` imports** (`./internal/class.js` etc.). Fixed once, globally, via `moduleNameMapper` in the `jest` block of `package.json`:
   ```json
   "moduleNameMapper": { "^(\\.{1,2}/.*)\\.js$": "$1" }
   ```
   If you ever see `Cannot find module './internal/class.js'` in a test run, this mapping is missing or was reverted — don't add a per-file workaround instead.

2. **Never let a unit test construct a real `pg.Pool` / real Prisma engine.** `src/prisma/test/prisma.service.spec.ts` is the reference pattern: mock `pg`'s `Pool` and `@prisma/adapter-pg`'s `PrismaPg` so no socket opens, mock `ConfigService.get` to return a fixture matching the `database` namespace shape, then assert the *wiring* (pool options passed through, `disposeExternalPool: true`, `$connect`/`$disconnect` called from the lifecycle hooks via `jest.spyOn(service, '$connect')`). Copy this pattern for any other service that extends or wraps `PrismaClient` directly.

---

## Developer guide — adding a new repository

1. Create `src/modules/<domain>/<domain>.repository.ts`, `extends BaseRepository`, constructor takes `PrismaService` (and `PaginationService` if you'll need list endpoints) and calls `super(prisma)`.
2. Define one or more `private readonly X_SELECT = { ... } as const` fields for the shapes you need — never `include`.
3. Every method signature ends with an optional `tx?: Prisma.TransactionClient`; first line is `const client = tx || this.prisma;`; use `client.<model>` for the actual call.
4. For `create`, decide `Prisma.<Model>CreateInput` vs `Prisma.<Model>UncheckedCreateInput` per the rule of thumb above.
5. For list endpoints, delegate to `PaginationService.paginate(client.<model>, params, { select, searchableFields, defaultSortField })` rather than hand-rolling `skip`/`take`.
6. In the owning service, call `withTransaction` only when a single business operation spans 2+ repository writes that must commit together — pass the same `tx` to every repository call inside the callback.
7. Import any enum from `generated/prisma/enums`, never from `generated/prisma/client`.
8. Register the repository as a provider in its feature module — `PrismaService` itself is already global (`@Global()` on `PrismaModule`), so you never import `PrismaModule` directly.
9. Write the repository's spec the same way as any other service-level test (mock `PrismaService` itself with `jest.fn()`s per method) — you only need the heavier `pg`/adapter mocking from the Testing section above when testing `PrismaService` itself.
