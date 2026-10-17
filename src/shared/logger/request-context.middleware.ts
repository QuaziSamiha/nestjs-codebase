import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContextService } from './request-context.service';

//* MUST RUN AFTER CorrelationIdMiddleware — READS req.correlationId (ALREADY SET) AND OPENS
//* THE ASYNCLOCALSTORAGE SCOPE FOR THE REST OF THE REQUEST'S ASYNC CHAIN (GUARDS, INTERCEPTORS,
//* CONTROLLER, SERVICES, EXCEPTION FILTER ALL RUN INSIDE THIS SCOPE).
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = (req as Request & { correlationId: string })
      .correlationId;
    this.requestContextService.run({ correlationId }, next);
  }
}
