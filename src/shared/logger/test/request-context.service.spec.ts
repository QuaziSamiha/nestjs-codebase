import { RequestContextService } from '../request-context.service';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('returns undefined for any key outside of a run() scope', () => {
    expect(service.get('correlationId')).toBeUndefined();
    expect(service.get('userId')).toBeUndefined();
  });

  it('makes seeded values readable inside the run() callback', () => {
    service.run({ correlationId: 'req-1', userId: 42 }, () => {
      expect(service.get('correlationId')).toBe('req-1');
      expect(service.get('userId')).toBe(42);
    });
  });

  it('set() updates a value visible for the rest of the same scope', () => {
    service.run({ correlationId: 'req-1' }, () => {
      expect(service.get('userId')).toBeUndefined();
      service.set('userId', 7);
      expect(service.get('userId')).toBe(7);
    });
  });

  it('set() outside any run() scope is a no-op (does not throw)', () => {
    expect(() => service.set('userId', 1)).not.toThrow();
    expect(service.get('userId')).toBeUndefined();
  });

  it('does not leak values back out once the run() callback returns', () => {
    service.run({ correlationId: 'req-1' }, () => {});
    expect(service.get('correlationId')).toBeUndefined();
  });

  //* THE CORE GUARANTEE THIS CLASS EXISTS FOR: TWO REQUESTS IN FLIGHT AT THE SAME TIME MUST
  //* NEVER SEE EACH OTHER'S correlationId/userId, EVEN THOUGH THEY INTERLEAVE ON THE SAME
  //* EVENT LOOP. THIS SIMULATES THAT BY DELIBERATELY INTERLEAVING TWO ASYNC run() SCOPES.
  it('keeps two concurrent async scopes isolated from each other', async () => {
    const seenInScopeA: (string | undefined)[] = [];
    const seenInScopeB: (string | undefined)[] = [];

    const scopeA = new Promise<void>((resolve) => {
      service.run({ correlationId: 'req-A' }, () => {
        void (async () => {
          seenInScopeA.push(service.get('correlationId'));
          await tick();
          seenInScopeA.push(service.get('correlationId'));
          resolve();
        })();
      });
    });

    const scopeB = new Promise<void>((resolve) => {
      service.run({ correlationId: 'req-B' }, () => {
        void (async () => {
          seenInScopeB.push(service.get('correlationId'));
          await tick();
          seenInScopeB.push(service.get('correlationId'));
          resolve();
        })();
      });
    });

    await Promise.all([scopeA, scopeB]);

    expect(seenInScopeA).toEqual(['req-A', 'req-A']);
    expect(seenInScopeB).toEqual(['req-B', 'req-B']);
  });
});
