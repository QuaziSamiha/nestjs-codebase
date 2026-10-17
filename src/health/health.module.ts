import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import healthConfig from './config/health.config';

@Module({
  //* PARTIAL REGISTRATION — HEALTHMODULE OWNS THE 'health' CONFIG NAMESPACE
  imports: [ConfigModule.forFeature(healthConfig), TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
