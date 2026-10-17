import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import throttlerConfig from './config/throttler.config';
import { AppThrottlerGuard } from './guards/app-throttler.guard';
import { THROTTLER_LONG, THROTTLER_SHORT } from './throttler.constants';

//* OWNS THE 'throttler' CONFIG NAMESPACE, THE NAMED TIERS, AND — THE PART THAT WAS MISSING
//* BEFORE — THE APP_GUARD REGISTRATION THAT MAKES ANY OF IT ENFORCE ANYTHING.
//*
//* THIS IS REGISTERED FIRST IN AppModule's imports SO THE THROTTLER IS THE FIRST GUARD IN
//* THE PIPELINE. IT IS THE ONLY APP_GUARD IN THIS APP TODAY (JwtAuthGuard/RolesGuard ARE
//* CONTROLLER-SCOPED VIA @UseGuards), SO NOTHING RUNS AHEAD OF IT. SEE
//* docs/concepts/rate-limiting.md §2.7 FOR WHY THROTTLE-BEFORE-AUTH IS THE DELIBERATE CHOICE.
@Module({
  imports: [
    ConfigModule.forFeature(throttlerConfig),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule.forFeature(throttlerConfig)],
      inject: [throttlerConfig.KEY],
      useFactory: (cfg: ConfigType<typeof throttlerConfig>) => {
        const logger = new Logger('AppThrottlerModule');

        //* THE KILL SWITCH BEING ON IS A SECURITY-RELEVANT STATE — SAY SO AT BOOT RATHER
        //* THAN LETTING A STALE .env QUIETLY LEAVE THE API UNLIMITED.
        if (!cfg.enabled) {
          logger.warn(
            'THROTTLE_ENABLED=false — rate limiting is DISABLED for every route.',
          );
        }

        //* NEVER LET A SET-BUT-UNUSED REDIS URL LOOK LIKE DISTRIBUTED LIMITING IS ON.
        //* SEE THE NOTE IN throttler.env.ts AND docs/concepts/rate-limiting.md §7.1.
        if (cfg.redisUrl) {
          logger.warn(
            'THROTTLE_REDIS_URL is set but Redis storage is not wired — falling back to ' +
              'in-memory storage. Counters are per-process and reset on restart, so the ' +
              'effective limit is (configured limit x instance count).',
          );
        }

        return {
          throttlers: [
            //* BURST — ABSORBS A PAGE LOAD'S PARALLEL XHRs, KILLS SCRIPTED FLOODS.
            {
              name: THROTTLER_SHORT,
              ttl: cfg.short.ttlMs,
              limit: cfg.short.limit,
            },
            //* SUSTAINED — THE REAL POLICY CEILING OVER A LONGER WINDOW.
            {
              name: THROTTLER_LONG,
              ttl: cfg.long.ttlMs,
              limit: cfg.long.limit,
            },
          ],
          //* ALL TTLs ARE MILLISECONDS. THE CONFIG LAYER NAMES THEM _TTL_MS SPECIFICALLY SO
          //* THE v5 UNIT CHANGE CANNOT BE MISREAD AGAIN — SEE docs/concepts/rate-limiting.md §2.10.
          //*
          //* NO storage: SUPPLIED — THE BUILT-IN IN-PROCESS ThrottlerStorageService (A Map IN
          //* THE NODE HEAP) IS USED. THAT IS AN ACCEPTED, DOCUMENTED CONSTRAINT WHILE THIS APP
          //* RUNS SINGLE-INSTANCE: COUNTERS ARE PER-PROCESS AND RESET ON EVERY RESTART/DEPLOY.
          //* GOING MULTI-INSTANCE MAKES REDIS STORAGE MANDATORY, NOT OPTIONAL.
          skipIf: () => !cfg.enabled,
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppThrottlerModule {}
