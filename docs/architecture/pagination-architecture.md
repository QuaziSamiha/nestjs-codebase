# Pagination — Architecture & Workflow

This document is the single map of every pagination-related file in this service: where it lives, what owns it, and how to wire a new endpoint into it. Read this before adding a paginated list endpoint or changing the shared pagination contract.

> See also: [Prisma architecture](./prisma-architecture.md) for how `PrismaService`/`BaseRepository` fit in — `PaginationService` calls straight into a Prisma model delegate as its data source. For concepts, features, and how to actually use this module from a repository/service/controller, see [Pagination concepts](../concepts/pagination-concepts.md).

---

## 1. File map (at a glance)

```
src/shared/pagination/
├── index.ts                                  # Single public entrypoint — barrel re-export of everything below
├── pagination.module.ts                      # Plain (non-@Global) module — provides/exports PaginationService
├── pagination.service.ts                     # The engine: paginate() — offset + cursor pagination over any data source
├── constants/
│   └── pagination.constants.ts               # DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_ORDER
├── dto/
│   └── pagination-query.dto.ts                # PaginationQueryDto — the @Query() shape every list endpoint accepts
├── interfaces/
│   ├── pagination-data-source.interface.ts   # IPaginationDataSource / TFindManyArgsOf — the ORM-agnostic port
│   └── pagination-result.interface.ts        # IPaginatedResult<T> / IPaginationMeta — the response shape
├── decorators/
│   └── paginated-response.decorator.ts        # @ApiPaginatedResponse(Model) — Swagger schema for {data, meta}
└── test/
    └── pagination.service.spec.ts             # Unit tests for paginate() (offset, cursor, search, sort, select/include)
```

---

## 2. How the pieces connect

```
HTTP GET /blog/all-blogs?page=2&limit=10&search=foo
   │
   ▼
@Query() paginationParams: PaginationQueryDto      (dto/pagination-query.dto.ts)
   - class-transformer coerces page/limit/cursor to numbers
   - class-validator enforces bounds (page ≥ 1, 1 ≤ limit ≤ MAX_PAGE_SIZE, sortOrder ∈ {asc, desc})
   │
   ▼
BlogController.getAllBlogs()
   │  passes paginationParams straight through, untouched
   ▼
BlogService.getAllBlogs(params)
   │  maps the eventual result.data through a Response DTO; never touches pagination internals
   ▼
BlogRepository.findAllBlogsAdmin(params)
   │  calls paginationService.paginate(client.blog, params, { select, searchableFields, defaultSortField })
   ▼
PaginationService.paginate<T, TSource>()             (pagination.service.ts)
   - builds a `search` → `OR` where-clause from `searchableFields`
   - merges it with the caller's explicit `where`
   - branches: params.cursor set → cursor pagination | else → page/limit (skip/take) pagination
   - runs model.count() and model.findMany() in parallel
   - computes IPaginationMeta (totalItems, itemCount, totalPages, currentPage, nextCursor)
   │
   ▼
IPaginatedResult<T>  { data: T[], meta: IPaginationMeta }   (interfaces/pagination-result.interface.ts)
   │
   ▼
Controller returns the result; ResponseInterceptor lifts meta into the envelope
   │
   ▼
@ApiPaginatedResponse(BlogResponseDto)  (decorators/paginated-response.decorator.ts)
   - documents the exact { data: Model[], meta: {...} } shape in Swagger, keyed off IPaginationMeta
```

Key point: **`PaginationService` never imports Prisma.** It only knows about `IPaginationDataSource` (anything with `count()`/`findMany()`). A `PrismaClient['blog']` delegate happens to satisfy that shape — so does any other repository, raw-SQL wrapper, or external API client that exposes the same two methods.

