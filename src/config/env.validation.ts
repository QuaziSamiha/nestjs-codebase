import { z } from 'zod';
import { databaseEnvSchema } from '../prisma/config/database.env';
import { authEnvSchema } from '../modules/auth/config/auth.env';
import { healthEnvSchema } from '../health/config/health.env';
import { loggerEnvSchema } from '../shared/logger/config/logger.env';
import { throttlerEnvSchema } from '../common/throttler/config/throttler.env';

//* APP-SHELL-OWNED FIELDS ONLY — VARS NOT TIED TO ANY SELF-CONTAINED DOMAIN MODULE.
//* EXPORTED SO app.config.ts CAN VALIDATE AGAINST THIS SLICE DIRECTLY, JUST LIKE EACH
//* DOMAIN MODULE VALIDATES AGAINST ITS OWN SCHEMA (database.env.ts, auth.env.ts).
export const appEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  //* DISPLAY NAME — USED IN SWAGGER, THE ROOT ENDPOINT AND OUTGOING EMAIL
  APP_NAME: z.string().min(1).default('My App'),
  PORT: z.coerce.number().default(8000),
  API_PREFIX: z.string().default('api/v1'),
  //* NORMALIZED AT BOOT — A TRAILING SLASH IN THE ENV VALUE (E.G.
  //* "https://api.example.com/") WOULD YIELD "//uploads/..." IN EVERY
  //* RESPONSE URL, SINCE STORED PATHS ALREADY START WITH "/".
  BASE_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),
  HASH_SALT_ROUNDS: z.coerce.number().default(10),

  // Mail
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().optional(),
  MAIL_USERNAME: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});

//* COMPOSED ROOT SCHEMA — MERGES EVERY SELF-CONTAINED MODULE'S OWN SCHEMA SO THE APP
//* STILL GETS ONE FAIL-FAST BOOT-TIME CHECK ACROSS ALL ENV VARS, WITHOUT THOSE MODULES
//* DEPENDING ON THIS FILE. THE DEPENDENCY DIRECTION IS: APP SHELL → DOMAIN MODULES.
const envSchema = appEnvSchema
  .merge(databaseEnvSchema)
  .merge(authEnvSchema)
  .merge(healthEnvSchema)
  .merge(loggerEnvSchema)
  .merge(throttlerEnvSchema);

export type EnvConfig = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Environment validation failed:\n${result.error.message}`);
  }
  return result.data;
}
