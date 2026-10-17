import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  correlationId: string;
  userId?: string | number;
  role?: string;
}

//* NODE-BUILT-IN ASYNCLOCALSTORAGE WRAPPER — NO EXTRA DEPENDENCY (VS. nestjs-cls) —
//* LETS ANY LOGGER CALL, ANYWHERE IN THE ASYNC CALL CHAIN OF A SINGLE REQUEST, READ
//* correlationId/userId/role WITHOUT THOSE VALUES BEING THREADED THROUGH EVERY FUNCTION SIGNATURE.
//* SCOPE IS OPENED ONCE PER REQUEST BY RequestContextMiddleware VIA run().
//*
//* `als` IS AN INSTANCE FIELD, NOT static — THIS CLASS RELIES ENTIRELY ON NEST'S DEFAULT
//* SINGLETON PROVIDER SCOPE FOR "ONE STORE PER PROCESS", THE SAME WAY EVERY OTHER INJECTABLE
//* IN THIS APP DOES. THE ONE CONSUMER THAT CAN'T USE NEST DI (winston-logger.factory.ts'S
//* PLAIN FORMAT FUNCTION) GETS THIS EXACT SINGLETON INSTANCE PASSED IN EXPLICITLY BY
//* LoggerModule AT WinstonModule.forRootAsync() SETUP TIME — SEE logger.module.ts.
@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContextStore>();

  run(store: RequestContextStore, callback: () => void): void {
    this.als.run(store, callback);
  }

  get<K extends keyof RequestContextStore>(
    key: K,
  ): RequestContextStore[K] | undefined {
    return this.als.getStore()?.[key];
  }

  set<K extends keyof RequestContextStore>(
    key: K,
    value: RequestContextStore[K],
  ): void {
    const store = this.als.getStore();
    if (store) {
      store[key] = value;
    }
  }
}
