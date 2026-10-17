import { registerAs } from '@nestjs/config';
import { loggerEnvSchema } from './logger.env';

//* NAMESPACE REGISTRATION — REGISTERS THIS FACTORY UNDER THE KEY 'LOGGER'
//* SO IT IS READ AS CONFIGSERVICE.GET('LOGGER.LEVEL'), NOT A RAW ENV LOOKUP
//* RESOLVES NODE_ENV-DEPENDENT DEFAULTS HERE SO CONSUMERS NEVER BRANCH ON NODE_ENV THEMSELVES
export default registerAs('logger', () => {
  const env = loggerEnvSchema.parse(process.env);
  const isProd = env.NODE_ENV === 'production';

  return {
    level: env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
    dir: env.LOG_DIR,
    maxSize: env.LOG_MAX_SIZE,
    maxFiles: `${env.LOG_RETENTION_DAYS}d`,
    consoleEnabled: env.LOG_CONSOLE_ENABLED,
    fileEnabled: env.LOG_FILE_ENABLED,
    errorFileEnabled: env.LOG_ERROR_FILE_ENABLED,
    jsonConsole: env.LOG_JSON_CONSOLE ?? isProd,
  };
});
