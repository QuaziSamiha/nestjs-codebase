import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { RequestContextService } from './request-context.service';

const HEALTH_ROUTE_PATTERN = /^\/health(\/|$)/;

//* ONE ACCESS-LOG LINE PER REQUEST, EMITTED ON Express's `finish` EVENT (NOT RxJS finalize()) —
//* `finish` FIRES ONLY AFTER THE RESPONSE HAS ACTUALLY BEEN SENT, SO response.statusCode IS
//* GUARANTEED TO BE THE FINAL VALUE FOR BOTH SUCCESS AND ERROR PATHS. finalize() FIRES TOO
//* EARLY — BEFORE GlobalExceptionFilter HAS SET THE ERROR STATUS — WHICH WAS VERIFIED TO
//* MISREPORT 400/500 RESPONSES AS 200. HEALTH-CHECK PROBES ARE DOWNGRADED TO 'verbose' SO
//* THEY DON'T FLOOD LOGS AT PRODUCTION'S DEFAULT 'info' LEVEL.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly requestContextService: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<
      Request & { user?: { id?: string | number; role?: string } }
    >();
    const response = httpContext.getResponse<Response>();
    const startedAt = Date.now();

    if (request.user?.id !== undefined) {
      this.requestContextService.set('userId', request.user.id);
    }
    if (request.user?.role !== undefined) {
      this.requestContextService.set('role', request.user.role);
    }

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const { method, path, ip } = request;
      const message = `${method} ${path} ${response.statusCode} ${durationMs}ms`;
      //* nest-winston's LoggerService ADAPTER ONLY MERGES EXTRA FIELDS AS META WHEN THE FIRST
      //* ARG IS AN OBJECT (IT DESTRUCTURES `message`/`level` OUT OF IT) — A STRING + SEPARATE
      //* META-OBJECT SECOND ARG WOULD BE MISREAD AS THE LOG `context` INSTEAD. CALL WITH ONE
      //* OBJECT ARG SO `new Logger('HTTP')` CAN STILL AUTO-APPEND ITS CONTEXT AS THE 2ND ARG.
      const payload = {
        message,
        method,
        path,
        statusCode: response.statusCode,
        durationMs,
        ip,
      };

      if (HEALTH_ROUTE_PATTERN.test(path)) {
        this.logger.verbose(payload);
      } else {
        this.logger.log(payload);
      }
    });

    return next.handle();
  }
}
