import { redactSensitiveFields } from '../utils/redact.util';
import {
  DEFAULT_REDACTED_KEYS,
  REDACTED_VALUE,
} from '../constants/logger.constants';

describe('redactSensitiveFields', () => {
  it('redacts a top-level sensitive key', () => {
    const result = redactSensitiveFields(
      { email: 'a@b.com', password: 'hunter2' },
      DEFAULT_REDACTED_KEYS,
    );

    expect(result).toEqual({ email: 'a@b.com', password: REDACTED_VALUE });
  });

  it('redacts sensitive keys at any nesting depth', () => {
    const result = redactSensitiveFields(
      { user: { profile: { refreshToken: 'abc.def.ghi', name: 'Sam' } } },
      DEFAULT_REDACTED_KEYS,
    );

    expect(result).toEqual({
      user: { profile: { refreshToken: REDACTED_VALUE, name: 'Sam' } },
    });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const result = redactSensitiveFields(
      { sessions: [{ token: 'a' }, { token: 'b' }] },
      DEFAULT_REDACTED_KEYS,
    );

    expect(result).toEqual({
      sessions: [{ token: REDACTED_VALUE }, { token: REDACTED_VALUE }],
    });
  });

  it('matches keys case-insensitively', () => {
    const result = redactSensitiveFields(
      { Password: 'x', AUTHORIZATION: 'Bearer y' },
      DEFAULT_REDACTED_KEYS,
    );

    expect(result).toEqual({
      Password: REDACTED_VALUE,
      AUTHORIZATION: REDACTED_VALUE,
    });
  });

  it('leaves non-sensitive fields untouched', () => {
    const input = { id: 1, name: 'Blog', active: true, tags: ['a', 'b'] };

    expect(redactSensitiveFields(input, DEFAULT_REDACTED_KEYS)).toEqual(input);
  });

  it('does not mutate the original input', () => {
    const input = { password: 'hunter2' };

    redactSensitiveFields(input, DEFAULT_REDACTED_KEYS);

    expect(input.password).toBe('hunter2');
  });

  //* REGRESSION TEST — isPlainObject USED TO TREAT ANY NON-ARRAY OBJECT AS WALKABLE, WHICH
  //* COLLAPSED NATIVE Error INSTANCES TO {} BECAUSE message/stack ARE NON-ENUMERABLE. THIS
  //* MUST STAY GREEN: A LOGGED Error OBJECT SHOULD PASS THROUGH INTACT, NOT BECOME {}.
  it('leaves a nested Error instance intact instead of collapsing it to {}', () => {
    const error = new Error('boom');
    const result = redactSensitiveFields(
      { context: 'X', error, stack: [error.stack] },
      DEFAULT_REDACTED_KEYS,
    ) as { context: string; error: Error; stack: unknown };

    expect(result.error).toBe(error);
    expect(result.error.message).toBe('boom');
  });

  it('leaves Date and RegExp instances intact', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const pattern = /abc/;

    const result = redactSensitiveFields(
      { date, pattern },
      DEFAULT_REDACTED_KEYS,
    );

    expect(result).toEqual({ date, pattern });
  });

  it('handles an empty redacted-key list by returning an equivalent object', () => {
    const input = { password: 'hunter2' };

    expect(redactSensitiveFields(input)).toEqual(input);
  });
});
