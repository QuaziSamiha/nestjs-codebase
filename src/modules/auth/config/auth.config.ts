import { registerAs } from '@nestjs/config';
import { authEnvSchema } from './auth.env';

//* NAMESPACE REGISTRATION — REGISTERS THIS FACTORY UNDER THE KEY 'AUTH'
//* SO IT IS READ AS CONFIGSERVICE.GET('AUTH.ACCESSSECRET'), NOT A RAW ENV LOOKUP
//* VALIDATES AGAINST ITS OWN SCHEMA (auth.env.ts) — NO DEPENDENCY ON THE APP SHELL,
//* SO src/modules/auth STAYS A SELF-CONTAINED MODULE THAT CAN BE COPIED INTO ANOTHER PROJECT
export default registerAs('auth', () => {
  const env = authEnvSchema.parse(process.env);
  return {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    refreshExpiresInMs: env.JWT_REFRESH_EXPIRES_IN_MS,
    googleClientId: env.GOOGLE_CLIENT_ID,
  };
});
