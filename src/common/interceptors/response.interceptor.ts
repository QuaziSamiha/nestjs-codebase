import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response/response-message.decorator';
import { IApiResponse } from '../interfaces/send-response.interface';
import { IPaginatedResult } from '../../shared/pagination';

const DEFAULT_SUCCESS_MESSAGE = 'Operation successful';

const isPaginatedResult = (
  value: unknown,
): value is IPaginatedResult<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  'data' in value &&
  'meta' in value;

/**
 * GOAL: GLOBAL SUCCESS-RESPONSE ENVELOPE.
 * CONTROLLERS JUST `return` THEIR RESULT (PLAIN, OR AN IPaginatedResult);
 * THIS BUILDS THE SAME {statusCode, success, message, data, meta?} SHAPE
 * sendResponse() USED TO BUILD MANUALLY, INCLUDING PAGINATION META.
 * ERRORS NEVER REACH HERE — THEY'RE THROWN AND HANDLED BY GlobalExceptionFilter.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<IApiResponse<unknown>> {
    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      DEFAULT_SUCCESS_MESSAGE;

    return next.handle().pipe(
      map((result: unknown): IApiResponse<unknown> => {
        const response = context
          .switchToHttp()
          .getResponse<{ statusCode: number }>();

        const { data, meta } = isPaginatedResult(result)
          ? result
          : { data: result, meta: undefined };

        return {
          statusCode: response.statusCode,
          success: true,
          message,
          data,
          ...(meta ? { meta } : {}),
        };
      }),
    );
  }
}
