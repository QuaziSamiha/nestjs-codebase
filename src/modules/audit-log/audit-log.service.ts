import { Injectable } from '@nestjs/common';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { IPaginatedResult } from '../../shared/pagination';

@Injectable()
export class AuditLogService {
  constructor(private readonly auditLogRepository: AuditLogRepository) {}

  async getAuditLogs(
    query: AuditLogQueryDto,
  ): Promise<IPaginatedResult<AuditLogResponseDto>> {
    //* SPLIT THE FILTER/SORT FIELDS OFF THE SHARED page/limit/search/sortOrder
    //* CONTRACT — PaginationService ONLY UNDERSTANDS THE LATTER.
    const { entityType, entityId, actorId, action, from, to, ...paginationParams } =
      query;

    const paginated = await this.auditLogRepository.findAll(paginationParams, {
      entityType,
      entityId,
      actorId,
      action,
      from,
      to,
    });

    return {
      ...paginated,
      data: paginated.data.map((row) => new AuditLogResponseDto(row)),
    };
  }
}
