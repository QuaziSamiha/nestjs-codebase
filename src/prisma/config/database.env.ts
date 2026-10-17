import { z } from 'zod';

//* SELF-CONTAINED ENV CONTRACT FOR THIS MODULE — NO DEPENDENCY ON THE APP SHELL'S config/env.validation.ts
//* LETS src/prisma BE COPIED INTO ANOTHER PROJECT AND VALIDATE ITSELF, WITH ZERO KNOWLEDGE OF UNRELATED DOMAINS
export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().default(10000),
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().default(0),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
