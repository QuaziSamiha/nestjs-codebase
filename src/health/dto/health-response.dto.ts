import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ example: { database: { status: 'up' } } })
  info!: Record<string, unknown> | null;

  @ApiProperty({ example: {} })
  error!: Record<string, unknown> | null;

  @ApiProperty({ example: { database: { status: 'up' } } })
  details!: Record<string, unknown>;
}
