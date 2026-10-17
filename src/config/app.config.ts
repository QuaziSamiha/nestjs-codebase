import { registerAs } from '@nestjs/config';
import { appEnvSchema } from './env.validation';

//* NAMESPACE REGISTRATION — REGISTERS THIS FACTORY UNDER THE KEY 'APP'
//* SO IT IS READ AS CONFIGSERVICE.GET('APP.PORT'), NOT A RAW ENV LOOKUP
//* VALIDATES AGAINST ITS OWN SLICE (appEnvSchema) — SAME SYMMETRIC PATTERN AS database.config.ts/auth.config.ts
export default registerAs('app', () => {
  const env = appEnvSchema.parse(process.env);
  return {
    name: env.APP_NAME,
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    baseUrl: env.BASE_URL,
    nodeEnv: env.NODE_ENV,
    saltRounds: env.HASH_SALT_ROUNDS,
  };
});
