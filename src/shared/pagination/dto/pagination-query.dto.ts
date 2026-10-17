import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  Min,
  IsString,
  IsIn,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_ORDER,
  MAX_PAGE_SIZE,
} from '../constants/pagination.constants';

/**
 * GOAL: PROVIDE FULLY DOCUMENTED API SCHEMA FOR FRONTEND CONSUMPTION.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'The active page number to fetch',
    example: DEFAULT_PAGE,
    minimum: DEFAULT_PAGE,
    default: DEFAULT_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Page must be a valid number' })
  @Min(DEFAULT_PAGE, { message: 'Page number must be at least 1' })
  page?: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: 'Amount of items returned per request',
    example: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Limit must be a valid number' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(MAX_PAGE_SIZE, {
    message: `Limit cannot exceed ${MAX_PAGE_SIZE} items per page`,
  })
  limit?: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Sorting direction for the list',
    enum: ['asc', 'desc'],
    example: DEFAULT_SORT_ORDER,
    default: DEFAULT_SORT_ORDER,
  })
  @IsOptional()
  @IsString({ message: 'Sort order must be a valid text string' })
  @IsIn(['asc', 'desc'], { message: 'Sort order must be either asc or desc' })
  sortOrder?: 'asc' | 'desc' = DEFAULT_SORT_ORDER;

  @ApiPropertyOptional({
    description:
      'Search term to filter results by name or other searchable fields',
    example: 'Organic Coffee',
  })
  @IsOptional()
  @IsString({ message: 'Search term must be a valid text string' })
  search?: string;

  @ApiPropertyOptional({
    description:
      'Last seen record ID for cursor-based pagination. Scales better than offset pagination on large tables. When provided, it takes precedence over `page` and the offset is ignored.',
    example: 120,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Cursor must be a valid number' })
  @Min(1, { message: 'Cursor must be at least 1' })
  cursor?: number;
}
