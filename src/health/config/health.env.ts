import { z } from 'zod';

//* SELF-CONTAINED ENV CONTRACT FOR THIS MODULE — NO DEPENDENCY ON THE APP SHELL'S config/env.validation.ts
//* LETS src/health BE COPIED INTO ANOTHER PROJECT AND VALIDATE ITSELF, WITH ZERO KNOWLEDGE OF UNRELATED DOMAINS
export const healthEnvSchema = z.object({
  HEALTH_MEMORY_HEAP_THRESHOLD_MB: z.coerce.number().default(500),
  HEALTH_DB_TIMEOUT_MS: z.coerce.number().default(5000),
  HEALTH_DISK_PATH: z.string().default(process.cwd()),
  HEALTH_DISK_THRESHOLD_PERCENT: z.coerce.number().min(0).max(1).default(0.9),
});

export type HealthEnv = z.infer<typeof healthEnvSchema>;
