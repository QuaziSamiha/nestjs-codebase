import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const timeoutMs = this.configService.get<number>('health.dbTimeoutMs')!;

    try {
      await this.pingWithTimeout(timeoutMs);
      return this.getStatus(key, true);
    } catch (e) {
      //* LOG THE REAL ERROR SERVER-SIDE ONLY — /health/* IS UNAUTHENTICATED, SO THE RESPONSE BODY
      //* MUST NEVER LEAK CONNECTION STRINGS, HOSTNAMES, OR DRIVER-LEVEL DB ERROR DETAILS
      this.logger.error(
        'Database health check failed',
        e instanceof Error ? e.stack : e,
      );
      return this.getStatus(key, false, { message: 'Database unavailable' });
    }
  }

  //* A HANGING (NOT REFUSED) CONNECTION WOULD OTHERWISE LET $queryRaw BLOCK INDEFINITELY,
  //* SO THE READINESS CHECK ITSELF NEEDS A HARD UPPER BOUND INDEPENDENT OF THE DRIVER'S OWN TIMEOUTS
  private pingWithTimeout(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Database ping exceeded ${timeoutMs}ms`)),
        timeoutMs,
      );

      this.prisma.$queryRaw`SELECT 1`
        .then(() => resolve())
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  }
}
