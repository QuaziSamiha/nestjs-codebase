import { REDACTED_VALUE } from '../constants/logger.constants';

//* EXCLUDES Error/Date/RegExp/Map/Set/CLASS INSTANCES ON PURPOSE — Object.entries() ON THOSE
//* (E.G. A NATIVE Error's message/stack ARE NON-ENUMERABLE) SILENTLY COLLAPSES THEM TO {}
//* INSTEAD OF LEAVING THEM INTACT. ONLY LITERAL OBJECTS ({} OR Object.create(null)) ARE WALKED.
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

//* DEEP-CLONES `value` AND REPLACES ANY KEY MATCHING `keys` (CASE-INSENSITIVE) AT ANY NESTING LEVEL.
//* USED BY BOTH THE WINSTON FORMAT PIPELINE AND THE ACCESS-LOG INTERCEPTOR — ONE REDACTION
//* IMPLEMENTATION, REUSED WHEREVER LOGGED DATA MIGHT CONTAIN SENSITIVE FIELDS.
export function redactSensitiveFields<T>(
  value: T,
  keys: readonly string[] = [],
): T {
  const redactedKeys = new Set(keys.map((key) => key.toLowerCase()));

  const redact = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(redact);
    }
    if (isPlainObject(input)) {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input)) {
        result[key] = redactedKeys.has(key.toLowerCase())
          ? REDACTED_VALUE
          : redact(val);
      }
      return result;
    }
    return input;
  };

  return redact(value) as T;
}
