import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/base.repository';
import { Prisma } from '../../generated/prisma/client';
import { AuditAction } from '../../generated/prisma/enums';
import { PaginationService, PaginationQueryDto } from '../../shared/pagination';

//* ALREADY-VALIDATED LIST FILTERS — PULLING THEM OFF THE QUERY DTO IS THE
//* SERVICE'S JOB, SO THIS ONLY BUILDS THE PRISMA FILTER.
export interface AuditLogListFilters {
  entityType?: string;
  entityId?: number;
  actorId?: number;
  action?: AuditAction;
  from?: Date;
  to?: Date;
}

//* actor's role/status ARE SELECTED SOLELY BECAUSE UserMinifiedResponseDto
//* (../user/dto/user-response.dto.ts) REQUIRES THEM — REUSED RATHER THAN
//* DEFINING A SECOND MINIFIED-USER SHAPE JUST FOR THIS MODULE.
export const AUDIT_LOG_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  action: true,
  diff: true,
  createdAt: true,
  actor: {
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      profile: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.AuditLogSelect;

@Injectable()
export class AuditLogRepository extends BaseRepository {
  constructor(
    prisma: PrismaService,
    private readonly paginationService: PaginationService,
  ) {
    super(prisma);
  }

  async findAll(
    params: PaginationQueryDto,
    filters: AuditLogListFilters = {},
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;

    const where: Prisma.AuditLogWhereInput = {
      AND: [
        ...(filters.entityType ? [{ entityType: filters.entityType }] : []),
        ...(filters.entityId !== undefined
          ? [{ entityId: filters.entityId }]
          : []),
        ...(filters.actorId !== undefined
          ? [{ actorId: filters.actorId }]
          : []),
        ...(filters.action ? [{ action: filters.action }] : []),
        ...(filters.from || filters.to
          ? [
              {
                createdAt: {
                  ...(filters.from ? { gte: filters.from } : {}),
                  ...(filters.to ? { lte: filters.to } : {}),
                },
              },
            ]
          : []),
      ],
    };

    return await this.paginationService.paginate<
      Prisma.AuditLogGetPayload<{ select: typeof AUDIT_LOG_SELECT }>,
      typeof client.auditLog
    >(client.auditLog, params, {
      select: AUDIT_LOG_SELECT,
      where,
      defaultSortField: 'createdAt',
    });
  }
}
