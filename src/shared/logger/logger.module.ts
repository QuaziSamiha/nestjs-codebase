import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import loggerConfig from './config/logger.config';
import {
  buildWinstonModuleOptions,
  LoggerConfig,
} from './winston-logger.factory';
import { RequestContextService } from './request-context.service';
import { RequestContextModule } from './request-context.module';

// GOAL: ENCAPSULATE AND EXPORT LOGGING FUNCTIONALITY FOR THE REST OF THE APP.
// RELATION: IMPORTS CONFIGMODULE, REGISTERS WINSTON AS NEST'S APP-WIDE LOGGER VIA WinstonModule.forRootAsync.
// WORKFLOW: SELF-CONTAINED — CAN BE COPIED TO ANOTHER PROJECT ALONGSIDE ITS OWN config/logger.env.ts.
@Module({
  imports: [
    RequestContextModule,
    ConfigModule.forFeature(loggerConfig),
    WinstonModule.forRootAsync({
      imports: [RequestContextModule, ConfigModule.forFeature(loggerConfig)],
      inject: [ConfigService, RequestContextService],
      useFactory: (
        configService: ConfigService,
        requestContextService: RequestContextService,
      ) =>
        buildWinstonModuleOptions(
          configService.get<LoggerConfig>('logger')!,
          requestContextService,
        ),
    }),
  ],
  exports: [RequestContextModule, WinstonModule],
})
export class LoggerModule {}
