import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { HealthResponseDto } from './dto/health-response.dto';
import { SKIP_ALL_THROTTLERS } from '../common/throttler/throttler.constants';

//* PROBES ARE HIT BY ORCHESTRATORS/LOAD BALANCERS EVERY FEW SECONDS — THE GLOBAL THROTTLER GUARD
//* (AppThrottlerModule) MUST NOT BE ABLE TO 429 THESE ROUTES AND GET THE POD KILLED FOR THE WRONG REASON
//*
//* MUST PASS SKIP_ALL_THROTTLERS EXPLICITLY. A BARE @SkipThrottle() DEFAULTS TO
//* { default: true } AND SKIPS ONLY A THROTTLER NAMED "default" — WITH THE NAMED short/long
//* TIERS THAT IS NO TIER AT ALL, AND THIS CONTROLLER *DID* START RETURNING 429 UNDER A
//* 35-REQUEST BURST BEFORE THIS ARGUMENT WAS ADDED. SEE throttler.constants.ts.
@SkipThrottle(SKIP_ALL_THROTTLERS)
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly memoryHeapThresholdBytes: number;
  private readonly diskPath: string;
  private readonly diskThresholdPercent: number;

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    configService: ConfigService,
  ) {
    this.memoryHeapThresholdBytes = configService.get<number>(
      'health.memoryHeapThresholdBytes',
    )!;
    this.diskPath = configService.get<string>('health.disk.path')!;
    this.diskThresholdPercent = configService.get<number>(
      'health.disk.thresholdPercent',
    )!;
  }

  //* GENERAL HEALTH SUMMARY — FOR MONITORING DASHBOARDS / UPTIME CHECKS, NOT TIED TO ORCHESTRATOR BEHAVIOR
  @Get()
  @HealthCheck()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'One or more dependencies are unhealthy',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', this.memoryHeapThresholdBytes),
      () =>
        this.disk.checkStorage('disk', {
          path: this.diskPath,
          thresholdPercent: this.diskThresholdPercent,
        }),
    ]);
  }

  //* LIVENESS — "IS THE PROCESS ALIVE?" NO DOWNSTREAM CALLS.
  //* FAILURE HERE TELLS THE ORCHESTRATOR TO KILL AND RESTART THE CONTAINER, SO IT MUST NEVER
  //* DEPEND ON THINGS THAT CAN BE TRANSIENTLY DOWN (E.G. THE DATABASE) OR IT CAUSES RESTART STORMS.
  @Get('live')
  @HealthCheck()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiInternalServerErrorResponse({ description: 'Process is unresponsive' })
  live(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', this.memoryHeapThresholdBytes),
    ]);
  }

  //* READINESS — "CAN THIS INSTANCE SERVE TRAFFIC RIGHT NOW?" CHECKS REAL DEPENDENCIES.
  //* FAILURE HERE TELLS THE LOAD BALANCER / SERVICE MESH TO STOP ROUTING TRAFFIC TO THIS POD
  //* WITHOUT RESTARTING IT, GIVING THE DEPENDENCY TIME TO RECOVER.
  @Get('ready')
  @HealthCheck()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'Dependency unreachable, not ready for traffic',
  })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () =>
        this.disk.checkStorage('disk', {
          path: this.diskPath,
          thresholdPercent: this.diskThresholdPercent,
        }),
    ]);
  }
}
