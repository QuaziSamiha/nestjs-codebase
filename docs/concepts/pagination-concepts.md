# Pagination — Concepts, Features & Developer Guide

This document explains *what* the shared pagination module does, *why* it's built this way, and *how* to use it from a repository, service, or controller. For the file map and the request-to-response wiring diagram, see [Pagination architecture](../architecture/pagination-architecture.md).

---

## 1. Purpose

Every list endpoint in this service (users, blogs, audit logs, ...) needs the same things: page/limit bounds, optional free-text search, a sort order, a standardized `{ data, meta }` response, and matching Swagger docs. `PaginationService.paginate()` centralizes all of that into one call so repositories never hand-roll `skip`/`take`/`count()` logic, and controllers never hand-write a pagination response schema.

---

## 2. Key concepts

### 2.1 The data-source port (ORM-agnostic by design)

```ts
// interfaces/pagination-data-source.interface.ts
export interface IPaginationDataSource {
  count(args: { where?: any }): Promise<number>;
  findMany(args: any): Promise<any[]>;
}

export type TFindManyArgsOf<TSource extends IPaginationDataSource> =
  Parameters<TSource['findMany']>[0];
```

- `IPaginationDataSource` is the **port**. `PaginationService.paginate()` is generic over `TSource extends IPaginationDataSource`, so it compiles against anything shaped like a Prisma model delegate — `PrismaClient['blog']`, `PrismaClient['user']`, a `Prisma.TransactionClient['blog']`, or a hand-rolled adapter for a non-Prisma source.
- `TFindManyArgsOf<TSource>` extracts the **exact** `findMany` argument type the concrete source declares (e.g. Prisma's generated `Prisma.BlogFindManyArgs`). This is why `options.where` / `options.select` / `options.include` in `paginate()` stay as strict as Prisma itself defines them instead of being hand-rolled `any` fields — a typo in a `select` key is still a compile error.
- Passing a `Prisma.TransactionClient`'s model delegate (instead of the top-level `PrismaService`'s) works transparently, since both satisfy the same shape. That's how `BlogRepository.findAllBlogsAdmin(params, tx?)` extends to transactional reads if needed.

**Rule:** never special-case Prisma inside `pagination.service.ts`. If a future need (e.g. Elasticsearch-backed search) doesn't fit `count()`/`findMany()`, extend the interface rather than branching on source type.

### 2.2 `PaginationQueryDto` — the shared query contract

| Field | Type | Default | Validation | Notes |
|---|---|---|---|---|
| `page` | `number` | `DEFAULT_PAGE` (1) | `@Min(1)` | Ignored once `cursor` is set |
| `limit` | `number` | `DEFAULT_PAGE_SIZE` (10) | `@Min(1)`, `@Max(MAX_PAGE_SIZE)` (100) | Used as `take` in both modes |
| `sortOrder` | `'asc' \| 'desc'` | `DEFAULT_SORT_ORDER` (`'desc'`) | `@IsIn(['asc','desc'])` | Applied to `defaultSortField` only — single-column sort |
| `search` | `string` | — | `@IsString()` | No-op unless the repository passes `searchableFields` |
| `cursor` | `number` | — | `@Min(1)` | **Presence flips the whole query into cursor mode** — see §2.3 |

All five tunable defaults (`DEFAULT_PAGE`, `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`, `DEFAULT_SORT_ORDER`, plus `DEFAULT_SORT_FIELD` used by `paginate()`'s `options`) live in one place: `constants/pagination.constants.ts`. Change a default there, not inline at the call site.

- Every paginated controller method takes exactly one `@Query() params: PaginationQueryDto` parameter — never hand-roll `@Query('page') page: number` etc. This keeps validation, defaults, and Swagger docs centralized.
- `@Type(() => Number)` (class-transformer) is required on every numeric field because query strings arrive as strings; without it, `@IsNumber()` would reject `"2"`.

### 2.3 Offset vs. cursor pagination

`paginate()` supports two mutually exclusive modes, selected by a single runtime check: `const isCursorMode = cursor !== undefined`.

| | Offset mode (default) | Cursor mode (`cursor` provided) |
|---|---|---|
| Trigger | `cursor` query param absent | `cursor` query param present |
| Prisma args | `skip: (page - 1) * limit` | `cursor: { id: cursor }, skip: 1` |
| Use case | Page-number UI (`1 2 3 ... 10`) | Infinite scroll / "load more" on large tables |
| Cost on large tables | `skip` forces the DB to scan and discard N rows — gets slower as `page` grows | `cursor` seeks directly via the indexed `id` — constant-time regardless of how deep you page |
| `meta.currentPage` | Meaningful (`params.page`) | Present but **meaningless** — there's no fixed page index in cursor mode |
| `meta.nextCursor` | `null` unless the caller also happens to fill a full page | The `id` of the last row in the current page; `null` once `data.length < limit` (last page reached) |

**Cursor assumption:** cursor pagination hard-codes `id` as the cursor field (`cursor: { id: cursor }`) and reads `lastItem.id` for `nextCursor`. Every model used with `paginate()` must have a numeric, monotonically-ordered `id` column — this is not currently pluggable per call.

**Precedence:** per the DTO's own doc comment, `cursor` "takes precedence over `page`" — if both are sent, `page`/`skip` math is simply never computed because the `isCursorMode` branch short-circuits it.

### 2.4 Search — `searchableFields` and dot-path nesting

`paginate()` builds an `OR` where-clause from `options.searchableFields` only when `params.search` is non-empty *and* the array is non-empty. Each entry is a field name, optionally dotted to reach into a relation:

```ts
// BlogRepository.findAllBlogsAdmin
searchableFields: ['title', 'slug']
// search = "foo" →
{ OR: [
  { title: { contains: 'foo', mode: 'insensitive' } },
  { slug:  { contains: 'foo', mode: 'insensitive' } },
] }
```

```ts
// dot-path → nested relation filter
searchableFields: ['profile.name']
// search = "bar" →
{ OR: [ { profile: { name: { contains: 'bar', mode: 'insensitive' } } } ] }
```

The generated `OR` clause is merged with the repository's own `where` via a plain object spread (`{ ...where, ...searchCondition }`). **This means a repository-supplied `where.OR` would be silently overwritten by the search condition** — if a repository needs both, it must combine them itself (e.g. nest its own `OR` inside an `AND`) before calling `paginate()`.

This merge is the one place the code intentionally widens past Prisma's strict `where` type (see the comment in `pagination.service.ts`) — a dynamically-keyed object built from `searchableFields` strings can't be statically checked against `Prisma.<Model>WhereInput`, so it's cast at that single point only.

### 2.5 Response shape — `IPaginatedResult<T>` and Swagger docs

```ts
// interfaces/pagination-result.interface.ts
interface IPaginationMeta {
  totalItems: number;     // COUNT(*) matching the filter
  itemCount: number;      // data.length for this response
  itemsPerPage: number;   // = limit, or totalItems if no limit was sent
  totalPages: number;     // ceil(totalItems / itemsPerPage), never 0
  currentPage: number;    // = page; not meaningful in cursor mode
  nextCursor: number | null;
}

interface IPaginatedResult<T> {
  data: T[];
  meta: IPaginationMeta;
}
```

- `T` is supplied explicitly by the caller at the `paginate<T, TSource>()` call site — typically `Prisma.<Model>GetPayload<{ select: typeof THE_SELECT_CONST }>` — so `result.data` is typed to the *exact* shape of the `select`/`include` that was passed, not a generic model type with extra fields the query never fetched.
- `@ApiPaginatedResponse(Model, description?)` (the decorator) generates the Swagger `{ data: Model[], meta: {...} }` schema for a controller method. Its `PAGINATION_META_SCHEMA` constant is typed as `Record<keyof IPaginationMeta, SchemaObject>` — adding, renaming, or removing a field on `IPaginationMeta` without updating this map is a compile error, not a silently-stale API doc.

---

## 3. Features & benefits

- **ORM-agnostic** — `paginate()` only depends on `IPaginationDataSource` (`count()`/`findMany()`), so it works with any Prisma model delegate (or, in principle, any other source shaped the same way) without code changes.
- **Type-safe per call site** — `TFindManyArgsOf<TSource>` and the explicit `T` generic mean `select`/`include`/`where` and the returned `data` array stay as strict as the concrete Prisma model, not loosely-typed `any`.
- **Dual pagination strategy, one API** — callers get offset *and* cursor pagination from the same `paginate()` call; the mode is chosen by whether `cursor` is present, with no separate method to learn.
- **Centralized, reusable query validation** — `PaginationQueryDto` is the single shape every paginated endpoint accepts; bounds (`MAX_PAGE_SIZE`, etc.) and error messages are defined once.
- **Self-documenting API contract** — `@ApiPaginatedResponse()` keeps Swagger docs compile-time linked to `IPaginationMeta`, so the documented response can't silently drift from what the service actually returns.
- **Built-in relation-aware search** — `searchableFields` supports dot-paths into relations without the repository writing any Prisma `OR`/nested-filter boilerplate by hand.

---

## 4. Use cases

| Scenario | Mode to use | Why |
|---|---|---|
| Admin table with page numbers (e.g. "Users" list with a pager) | Offset (`page`/`limit`) | Users expect to jump to an arbitrary page number; `meta.currentPage`/`totalPages` drive the pager UI. |
| Infinite scroll / "Load more" feed on a large or fast-growing table | Cursor (`cursor`) | Avoids the `skip`-scans-and-discards cost that grows with page depth; `meta.nextCursor` tells the client exactly what to send next. |
| Search-as-you-type over a list (e.g. filter blog posts by title while typing) | Either mode + `search` | Pass `searchableFields` so the typed term filters via a case-insensitive `OR`, without writing a custom Prisma query. |
| Admin needs a flat dropdown of *all* matching rows, no pager (e.g. every option for a `<select>`) | **Don't use `paginate()`** | This is an unbounded read, not a paginated list — call `findMany()` directly in the repository. |

---

## 5. Developer guide — how to use it

Using `BlogModule` as the reference implementation, here's the four-step recipe for wiring a new paginated endpoint:

1. **Module** — import `PaginationModule` alongside `PrismaModule` in the feature module (`PaginationModule` is **not** `@Global()` — every feature module that needs `PaginationService` must import it explicitly):
   ```ts
   @Module({ imports: [PrismaModule, PaginationModule], ... })
   ```
2. **Repository** — inject `PaginationService`, define a `<MODEL>_SELECT` const, and delegate:
   ```ts
   constructor(prisma: PrismaService, private readonly paginationService: PaginationService) {
     super(prisma);
   }

   async findAllBlogsAdmin(params: PaginationQueryDto, tx?: Prisma.TransactionClient) {
     const client = tx || this.prisma;
     return this.paginationService.paginate<
       Prisma.BlogGetPayload<{ select: typeof BLOG_SELECT_ADMIN }>,
       typeof client.blog
     >(client.blog, params, {
       select: BLOG_SELECT_ADMIN,
       searchableFields: ['title', 'slug'],
       defaultSortField: 'createdAt',
     });
   }
   ```
3. **Service** — pass `PaginationQueryDto` straight through; only map `result.data` into a response DTO, never touch `meta`:
   ```ts
   async getAllBlogs(params: PaginationQueryDto): Promise<IPaginatedResult<BlogResponseDto>> {
     const result = await this.blogRepository.findAllBlogsAdmin(params);
     return { ...result, data: result.data.map((b) => new BlogResponseDto(b, this.configService.get<string>('app.baseUrl'))) };
   }
   ```
4. **Controller** — accept `@Query() params: PaginationQueryDto`, decorate with `@ApiPaginatedResponse(ResponseDto, '...')`, and return the service result. The global `ResponseInterceptor` lifts `meta` into the response envelope:
   ```ts
   @Get('all-blogs')
   @ApiPaginatedResponse(BlogResponseDto, 'Blogs retrieved successfully.')
   @ResponseMessage('Blogs retrieved successfully')
   async getAllBlogs(@Query() params: PaginationQueryDto) {
     return this.blogService.getAllBlogs(params);
   }
   ```

---

## 6. Conventions & best practices

- **Always** route list endpoints through `PaginationService.paginate()` — don't hand-roll `skip`/`take`/`count()` logic in a repository. The sanctioned exception is an *unbounded* "give me everything matching this filter" read with no UI pager (e.g. a dropdown source), which is not a paginated list.
- **Always** type the `paginate<T, TSource>()` call explicitly with `Prisma.<Model>GetPayload<{ select: typeof YOUR_SELECT_CONST }>` as `T` — don't let it infer `any`, or the repository loses the compile-time link between its `select` and its return type.
- **Never** add a field to `IPaginationMeta` without also adding it to `PAGINATION_META_SCHEMA` in `paginated-response.decorator.ts` — the `Record<keyof IPaginationMeta, ...>` typing will fail to compile until you do, by design.
- **Never** rely on `meta.currentPage` or `meta.totalPages` in cursor mode — they're computed but not meaningful; cursor-mode clients should drive pagination off `meta.nextCursor` only.
- Cursor pagination requires the model to have a numeric `id` primary key ordered consistently with `defaultSortField`/`sortOrder` — don't wire cursor mode onto a model without one.
- If a repository needs its own `OR` clause *and* `searchableFields`, combine them manually before calling `paginate()` (see §2.4) — the library does a shallow merge and will let one `OR` clobber the other.
- Any new default (page size, sort field, sort order, etc.) belongs in `constants/pagination.constants.ts`, not as an inline literal at the call site — see §2.2.
