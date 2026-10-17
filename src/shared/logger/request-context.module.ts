import { Module } from '@nestjs/common';
import { RequestContextService } from './request-context.service';
import { RequestContextMiddleware } from './request-context.middleware';

//* SPLIT OUT FROM LoggerModule SO THE SAME RequestContextService SINGLETON CAN BE DI-INJECTED
//* INTO TWO INDEPENDENT PLACES: RequestContextMiddleware (VIA APP.MODULE.TS'S configure()) AND
//* WinstonModule.forRootAsync()'S useFactory (VIA winston-logger.factory.ts) — WITHOUT LoggerModule
//* IMPORTING ITS OWN NESTED WinstonModule REGISTRATION, WHICH WOULD BE CIRCULAR.
@Module({
  providers: [RequestContextService, RequestContextMiddleware],
  exports: [RequestContextService, RequestContextMiddleware],
})
export class RequestContextModule {}
