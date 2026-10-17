import { registerAs } from '@nestjs/config';
import { databaseEnvSchema } from './database.env';

//* NAMESPACE REGISTRATION — REGISTERS THIS FACTORY UNDER THE KEY 'database'
//* SO IT IS READ AS configService.get('database.url'), OWNED BY PRISMAMODULE
//* VALIDATES AGAINST ITS OWN SCHEMA (database.env.ts) — NO DEPENDENCY ON THE APP SHELL,
//* SO src/prisma STAYS A SELF-CONTAINED MODULE THAT CAN BE COPIED INTO ANOTHER PROJECT
export default registerAs('database', () => {
  const env = databaseEnvSchema.parse(process.env);
  return {
    url: env.DATABASE_URL,
    pool: {
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    },
  };
});
