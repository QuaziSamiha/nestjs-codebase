import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { AuditAction } from '../../../generated/prisma/enums';
import {
  MinifiedUser,
  UserMinifiedResponseDto,
} from '../../user/dto/user-response.dto';

export class AuditLogResponseDto {
  @Expose()
  @ApiProperty({ description: 'Internal auto-increment ID', example: 1 })
  id!: number;

  @Expose()
  @ApiProperty({
    description: 'The Prisma model name this row changed',
    example: 'Blog',
  })
  entityType!: string;

  @Expose()
  @ApiProperty({ description: 'Internal ID of the changed row', example: 42 })
  entityId!: number;

  @Expose()
  @ApiProperty({
    enum: AuditAction,
    description: 'What kind of change this was',
    example: AuditAction.UPDATE,
  })
  action!: AuditAction;

  @Expose()
  @ApiPropertyOptional({
    description:
      'Only the fields that actually changed. CREATE has `after` only, DELETE has `before` only, UPDATE/SOFT_DELETE have both — each keyed by the field name that differed.',
    example: { before: { status: 'DRAFT' }, after: { status: 'ACTIVE' } },
  })
  diff?: { before?: Record<string, unknown>; after?: Record<string, unknown> };

  @Expose()
  @ApiPropertyOptional({
    type: () => UserMinifiedResponseDto,
    description: 'The authenticated user who made the change, if any',
  })
  @Type(() => UserMinifiedResponseDto)
  actor?: UserMinifiedResponseDto;

  @Expose()
  @ApiProperty({ description: 'When this change was recorded' })
  createdAt!: Date;

  constructor(row: {
    id: number;
    entityType: string;
    entityId: number;
    action: AuditAction;
    diff?: unknown;
    actor?: MinifiedUser | null;
    createdAt: Date;
  }) {
    this.id = row.id;
    this.entityType = row.entityType;
    this.entityId = row.entityId;
    this.action = row.action;
    this.diff = (row.diff ?? undefined) as
      | { before?: Record<string, unknown>; after?: Record<string, unknown> }
      | undefined;
    this.actor =
      row.actor && typeof row.actor === 'object'
        ? new UserMinifiedResponseDto(row.actor)
        : undefined;
    this.createdAt = row.createdAt;
  }
}
