import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

//* DRIVEN BY NODE_ENV, NOT HARDCODED — WORKS FOR ANY ENVIRONMENT NAME
//* (DEVELOPMENT, OFFICE, PRODUCTION, ...) WITHOUT TOUCHING THIS FILE AGAIN
const nodeEnv = process.env.NODE_ENV || 'development';

//* DOTENV NEVER OVERWRITES A VAR ALREADY SET, SO THE FIRST MATCH WINS —
//* SAME PRECEDENCE ORDER AS THE NESTJS app'S ConfigModule.forRoot
loadEnv({ path: `.env.${nodeEnv}.local` }); // * PERSONAL / GITIGNORED OVERRIDES
loadEnv({ path: `.env.${nodeEnv}` }); // * SHARED, PER-ENVIRONMENT DEFAULTS
loadEnv({ path: '.env' }); // * GENERIC FALLBACK

export default defineConfig({
  schema: 'prisma/schema', //* MULTI-FILE SCHEMA FOLDER — PRISMA MERGES ALL .PRISMA FILES INSIDE
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
