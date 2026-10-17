import { registerAs } from '@nestjs/config';
import { healthEnvSchema } from './health.env';

//* NAMESPACE REGISTRATION — REGISTERS THIS FACTORY UNDER THE KEY 'health'
//* SO IT IS READ AS configService.get('health.memoryHeapThresholdBytes'), OWNED BY HEALTHMODULE
//* VALIDATES AGAINST ITS OWN SCHEMA (health.env.ts) — NO DEPENDENCY ON THE APP SHELL,
//* SO src/health STAYS A SELF-CONTAINED MODULE THAT CAN BE COPIED INTO ANOTHER PROJECT
export default registerAs('health', () => {
  const env = healthEnvSchema.parse(process.env);
  return {
    memoryHeapThresholdBytes: env.HEALTH_MEMORY_HEAP_THRESHOLD_MB * 1024 * 1024,
    dbTimeoutMs: env.HEALTH_DB_TIMEOUT_MS,
    disk: {
      path: env.HEALTH_DISK_PATH,
      thresholdPercent: env.HEALTH_DISK_THRESHOLD_PERCENT,
    },
  };
});
