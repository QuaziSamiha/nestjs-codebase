import { Injectable } from '@nestjs/common';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { IPaginatedResult } from './interfaces/pagination-result.interface';
import {
  IPaginationDataSource,
  TFindManyArgsOf,
} from './interfaces/pagination-data-source.interface';
import { DEFAULT_SORT_FIELD } from './constants/pagination.constants';

@Injectable()
export class PaginationService {
  /**
   * GOAL: REUSABLE OFFSET/CURSOR PAGINATION OVER ANY IPaginationDataSource.
   * CALLERS SUPPLY <T> EXPLICITLY (E.G. Prisma.UserGetPayload<{ select: ... }>)
   * SO THE RETURNED data ARRAY MATCHES THE EXACT select/include THEY PASSED.
   * WHEN params.cursor IS SET, CURSOR PAGINATION IS USED INSTEAD OF skip/take
   * OFFSETS, WHICH STAYS PERFORMANT ON LARGE TABLES.
   */
  async paginate<T, TSource extends IPaginationDataSource>(
    model: TSource,
    params: PaginationQueryDto,
    options: {
      where?: TFindManyArgsOf<TSource>['where'];
      include?: TFindManyArgsOf<TSource>['include'];
      select?: TFindManyArgsOf<TSource>['select'];
      searchableFields?: string[];
      defaultSortField?: string;
    } = {},
  ): Promise<IPaginatedResult<T>> {
    const { page, limit, sortOrder, search, cursor } = params;
    const {
      where = {},
      include,
      select,
      searchableFields = [],
      defaultSortField = DEFAULT_SORT_FIELD,
    } = options;

    const searchCondition: Record<string, any> =
      search && searchableFields.length > 0
        ? {
            OR: searchableFields.map((field) => {
              const parts = field.split('.');
              let condition: Record<string, any> = {
                [parts[parts.length - 1]]: {
                  contains: search,
                  mode: 'insensitive',
                },
              };
              for (let i = parts.length - 2; i >= 0; i--) {
                condition = { [parts[i]]: condition };
              }
              return condition;
            }),
          }
        : {};

    // MERGING A DYNAMICALLY-KEYED SEARCH CONDITION CANNOT BE EXPRESSED
    // THROUGH THE SOURCE'S STRICT `where` TYPE, SO IT'S WIDENED HERE ONLY.
    const combinedWhere = {
      ...where,
      ...searchCondition,
    } as TFindManyArgsOf<TSource>['where'];
    const isCursorMode = cursor !== undefined;

    const [totalItems, data] = await Promise.all([
      model.count({ where: combinedWhere }),
      model.findMany({
        where: combinedWhere,
        include,
        select,
        ...(isCursorMode
          ? { cursor: { id: cursor }, skip: 1 }
          : { skip: page && limit ? (page - 1) * limit : undefined }),
        take: limit,
        orderBy: { [defaultSortField]: sortOrder },
      } as TFindManyArgsOf<TSource>),
    ]);

    const itemsPerPage = limit || totalItems;
    const currentPage = page || 1;
    const lastItem = data[data.length - 1] as { id?: number } | undefined;
    const nextCursor =
      limit && data.length === limit && lastItem?.id !== undefined
        ? lastItem.id
        : null;

    return {
      data: data as T[],
      meta: {
        totalItems,
        itemCount: data.length,
        itemsPerPage,
        totalPages: Math.ceil(totalItems / itemsPerPage) || 1,
        currentPage,
        nextCursor,
      },
    };
  }
}
