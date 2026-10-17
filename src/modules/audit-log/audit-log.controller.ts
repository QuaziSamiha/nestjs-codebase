import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { ApiPaginatedResponse } from '../../shared/pagination';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/auth/roles.decorator';
import { ResponseMessage } from '../../common/decorators/response/response-message.decorator';
import { UserRole } from '../../generated/prisma/enums';

@ApiTags('Audit Log')
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get audit log (paginated)',
    description:
      'Change history for every tracked model (see TRACKED_AUDIT_MODELS) — see docs/audit-log.md. Filterable by entityType/entityId/actorId/action and a createdAt date range, newest first. Admin only.',
  })
  @ApiPaginatedResponse(
    AuditLogResponseDto,
    'Audit logs retrieved successfully.',
  )
  @ApiBadRequestResponse({
    description: 'Invalid pagination, filter or sort parameter.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  @ResponseMessage('Audit logs retrieved successfully')
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.auditLogService.getAuditLogs(query);
  }
}
