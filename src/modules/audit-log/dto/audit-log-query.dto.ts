import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import { AuditAction } from '../../../generated/prisma/enums';
import {
  TRACKED_AUDIT_MODELS,
  type TrackedAuditModel,
} from '../../../prisma/extensions/audit-log.extension';

//* WHITELIST OF SORTABLE COLUMNS. AuditLog IS APPEND-ONLY AND
//* NEVER UPDATED, SO `createdAt` IS THE ONLY MEANINGFUL SORT.
export const AUDIT_LOG_SORT_FIELDS = ['createdAt'] as const;
export type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];

//* EXTENDS THE SHARED PAGE/LIMIT/SORT-ORDER CONTRACT WITH THE AUDIT TABLE'S
//* OWN FILTERS. EVERY FILTER IS OPTIONAL AND ADDITIVE — OMITTING ALL OF THEM
//* RETURNS THE PLAIN PAGINATED LIST, NEWEST FIRST.
export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TRACKED_AUDIT_MODELS,
    description:
      'Filter to a single tracked model (the Prisma model name, e.g. "Blog"). Omit to see every tracked model.',
    example: 'Blog',
  })
  @IsOptional()
  @IsIn(TRACKED_AUDIT_MODELS, {
    message: `entityType must be one of: ${TRACKED_AUDIT_MODELS.join(', ')}`,
  })
  entityType?: TrackedAuditModel;

  @ApiPropertyOptional({
    description:
      'Filter to a single row’s change history. Combine with entityType to fully scope to one record — e.g. every change to Blog #42.',
    example: 42,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'entityId must be a valid integer' })
  @Min(1, { message: 'entityId must be at least 1' })
  entityId?: number;

  @ApiPropertyOptional({
    description: 'Filter to changes made by a single user (internal user ID).',
    example: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'actorId must be a valid integer' })
  @Min(1, { message: 'actorId must be at least 1' })
  actorId?: number;

  @ApiPropertyOptional({
    enum: AuditAction,
    enumName: 'AuditAction',
    description: 'Filter by change type.',
    example: AuditAction.UPDATE,
  })
  @IsOptional()
  @IsEnum(AuditAction, { message: 'Please select a valid audit action' })
  action?: AuditAction;

  @ApiPropertyOptional({
    description: 'Only include rows created on or after this timestamp.',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid date' })
  from?: Date;

  @ApiPropertyOptional({
    description: 'Only include rows created on or before this timestamp.',
    example: '2026-08-31T23:59:59.999Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid date' })
  to?: Date;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: AUDIT_LOG_SORT_FIELDS,
    default: 'createdAt',
    example: 'createdAt',
  })
  @IsOptional()
  @IsIn(AUDIT_LOG_SORT_FIELDS, {
    message: `sortBy must be one of: ${AUDIT_LOG_SORT_FIELDS.join(', ')}`,
  })
  sortBy?: AuditLogSortField;
}
