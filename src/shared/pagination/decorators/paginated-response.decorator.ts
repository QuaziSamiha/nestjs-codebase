import { applyDecorators, Type } from '@nestjs/common';
import { ApiOkResponse, getSchemaPath, ApiExtraModels } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { IPaginationMeta } from '../interfaces/pagination-result.interface';

/**
 * GOAL: KEEP THE SWAGGER `meta` SCHEMA IN LOCKSTEP WITH IPaginationMeta.
 * TYPING THIS AS Record<keyof IPaginationMeta, SchemaObject> MEANS ADDING,
 * REMOVING, OR RENAMING A FIELD ON THE INTERFACE WITHOUT UPDATING THIS MAP
 * IS A COMPILE ERROR INSTEAD OF SILENTLY WRONG API DOCS.
 */
const PAGINATION_META_SCHEMA: Record<keyof IPaginationMeta, SchemaObject> = {
  totalItems: {
    type: 'number',
    description: 'Total records matching the filter.',
  },
  itemCount: {
    type: 'number',
    description: 'Number of records in this response.',
  },
  itemsPerPage: {
    type: 'number',
    description: 'Maximum records permitted per page.',
  },
  totalPages: { type: 'number', description: 'Total navigable pages.' },
  currentPage: {
    type: 'number',
    description: 'Current active page (1-based).',
  },
  nextCursor: {
    type: 'number',
    nullable: true,
    description: 'Cursor for the next page; null on the last page.',
  },
};

export const ApiPaginatedResponse = <TModel extends Type<any>>(
  model: TModel,
  description = 'Paginated list retrieved successfully.',
) => {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description,
      schema: {
        properties: {
          data: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
          meta: {
            type: 'object',
            properties: PAGINATION_META_SCHEMA,
          },
        },
      },
    }),
  );
};
