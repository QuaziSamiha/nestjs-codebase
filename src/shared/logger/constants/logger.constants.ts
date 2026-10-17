//* KEYS REDACTED FROM ANY LOGGED OBJECT (CASE-INSENSITIVE MATCH) — SEE utils/redact.util.ts
export const DEFAULT_REDACTED_KEYS = [
  'password',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'otp',
  'secret',
  'apiKey',
] as const;

export const REDACTED_VALUE = '[REDACTED]';
