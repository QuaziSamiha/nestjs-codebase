import { Test, TestingModule } from '@nestjs/testing';
import { PaginationService } from '../pagination.service';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { IPaginationDataSource } from '../interfaces/pagination-data-source.interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockDataSource = IPaginationDataSource & {
  count: jest.Mock;
  findMany: jest.Mock;
};

const makeSource = (
  overrides: Partial<MockDataSource> = {},
): MockDataSource => ({
  count: jest.fn().mockResolvedValue(0),
  findMany: jest.fn().mockResolvedValue([]),
  ...overrides,
});

const makeParams = (overrides: Partial<PaginationQueryDto> = {}) =>
  ({ ...overrides }) as PaginationQueryDto;

describe('PaginationService', () => {
  let service: PaginationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaginationService],
    }).compile();
    service = module.get(PaginationService);
  });

  // -------------------------------------------------------------------------
  // offset pagination
  // -------------------------------------------------------------------------

  describe('offset pagination', () => {
    it('computes skip/take from page and limit, and builds the meta block', async () => {
      const source = makeSource({
        count: jest.fn().mockResolvedValue(25),
        findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      });

      const result = await service.paginate(
        source,
        makeParams({ page: 3, limit: 10, sortOrder: 'desc' }),
      );

      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta).toEqual({
        totalItems: 25,
        itemCount: 2,
        itemsPerPage: 10,
        totalPages: 3,
        currentPage: 3,
        nextCursor: null,
      });
    });

    it('falls back itemsPerPage to totalItems and currentPage to 1 when not provided', async () => {
      const source = makeSource({ count: jest.fn().mockResolvedValue(7) });

      const result = await service.paginate(source, makeParams());

      expect(result.meta.itemsPerPage).toBe(7);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.currentPage).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // cursor pagination
  // -------------------------------------------------------------------------

  describe('cursor pagination', () => {
    it('uses cursor/skip:1 instead of a page offset when cursor is provided', async () => {
      const source = makeSource({
        count: jest.fn().mockResolvedValue(50),
        findMany: jest
          .fn()
          .mockResolvedValue(
            Array.from({ length: 10 }, (_, i) => ({ id: 21 + i })),
          ),
      });

      const result = await service.paginate(
        source,
        makeParams({ cursor: 20, limit: 10, sortOrder: 'desc' }),
      );

      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 20 }, skip: 1, take: 10 }),
      );
      expect(result.meta.nextCursor).toBe(30);
    });

    it('returns a null nextCursor on the last page (fewer items than the limit)', async () => {
      const source = makeSource({
        count: jest.fn().mockResolvedValue(25),
        findMany: jest.fn().mockResolvedValue([{ id: 25 }]),
      });

      const result = await service.paginate(
        source,
        makeParams({ cursor: 24, limit: 10 }),
      );

      expect(result.meta.nextCursor).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // search condition building
  // -------------------------------------------------------------------------

  describe('search condition building', () => {
    it('builds a flat OR condition for a top-level searchable field', async () => {
      const source = makeSource();

      await service.paginate(source, makeParams({ search: 'foo' }), {
        searchableFields: ['email'],
      });

      const expectedWhere = {
        OR: [{ email: { contains: 'foo', mode: 'insensitive' } }],
      };
      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(source.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('builds a nested OR condition for a dot-path searchable field', async () => {
      const source = makeSource();

      await service.paginate(source, makeParams({ search: 'bar' }), {
        searchableFields: ['profile.firstName'],
      });

      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              {
                profile: {
                  firstName: { contains: 'bar', mode: 'insensitive' },
                },
              },
            ],
          },
        }),
      );
    });

    it('ignores the search term when no searchableFields are configured', async () => {
      const source = makeSource();

      await service.paginate(source, makeParams({ search: 'foo' }));

      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('merges an explicit where filter with the generated search condition', async () => {
      const source = makeSource();

      await service.paginate(source, makeParams({ search: 'foo' }), {
        where: { status: 'ACTIVE' },
        searchableFields: ['email'],
      });

      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'ACTIVE',
            OR: [{ email: { contains: 'foo', mode: 'insensitive' } }],
          },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // sorting
  // -------------------------------------------------------------------------

  describe('sorting', () => {
    it('orders by the given defaultSortField', async () => {
      const source = makeSource();

      await service.paginate(source, makeParams({ sortOrder: 'asc' }), {
        defaultSortField: 'displayOrder',
      });

      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { displayOrder: 'asc' } }),
      );
    });

    it('falls back to createdAt when no defaultSortField is given', async () => {
      const source = makeSource();

      await service.paginate(source, makeParams({ sortOrder: 'desc' }));

      expect(source.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // select / include passthrough
  // -------------------------------------------------------------------------

  it('forwards select and include through to findMany untouched', async () => {
    const source = makeSource();

    await service.paginate(source, makeParams(), {
      select: { id: true },
      include: { profile: true },
    });

    expect(source.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true },
        include: { profile: true },
      }),
    );
  });
});
