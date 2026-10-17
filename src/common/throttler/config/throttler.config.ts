import { registerAs } from '@nestjs/config';
import { throttlerEnvSchema } from './throttler.env';

//* NAMESPACE REGISTRATION — REGISTERS THIS FACTORY UNDER THE KEY 'throttler'
//* SO IT IS READ AS configService.get('throttler.short.limit'), OWNED BY AppThrottlerModule.
//* VALIDATES AGAINST ITS OWN SCHEMA (throttler.env.ts) — NO DEPENDENCY ON THE APP SHELL,
//* SO src/common/throttler STAYS A SELF-CONTAINED MODULE THAT CAN BE COPIED ELSEWHERE.
export default registerAs('throttler', () => {
  const env = throttlerEnvSchema.parse(process.env);
  return {
    enabled: env.THROTTLE_ENABLED,
    short: {
      ttlMs: env.THROTTLE_SHORT_TTL_MS,
      limit: env.THROTTLE_SHORT_LIMIT,
    },
    long: {
      ttlMs: env.THROTTLE_LONG_TTL_MS,
      limit: env.THROTTLE_LONG_LIMIT,
    },
    trustProxyHops: env.THROTTLE_TRUST_PROXY_HOPS,
    redisUrl: env.THROTTLE_REDIS_URL,
  };
});
