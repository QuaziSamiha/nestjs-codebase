import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  HttpException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ValidationError } from 'class-validator';
import { ThrottlerException } from '@nestjs/throttler';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { Prisma } from '../../generated/prisma/client';
import { formatValidationErrors } from '../utils/validation.util';

//* MAPS THE MOST COMMON PRISMA ERROR CODES TO A SAFE, ACTIONABLE CLIENT
//* RESPONSE. CODES NOT LISTED HERE (E.G. P2021 "TABLE/COLUMN DOES NOT
//* EXIST" — A SCHEMA/MIGRATION DRIFT BUG, NOT A CLIENT MISTAKE) FALL
//* THROUGH TO THE GENERIC 500 BELOW.
function mapPrismaError(
  exception: Prisma.PrismaClientKnownRequestError,
): { statusCode: number; message: string; error: string } | null {
  switch (exception.code) {
    case 'P2002': {
      const target = exception.meta?.target;
      //* meta.target IS AN ARRAY OF COLUMN NAMES ON SOME PROVIDERS BUT A
      //* SINGLE CONSTRAINT-NAME STRING (E.G. "users_auth_provider_provider_id_key") ON
      //* OTHERS — SURFACE BOTH SO THE 409 SAYS WHICH FIELD COLLIDED
      const fields = Array.isArray(target)
        ? target.join(', ')
        : typeof target === 'string' && target
          ? target
          : 'field';
      return {
        statusCode: HttpStatus.CONFLICT,
        message: `A record with this ${fields} already exists`,
        error: 'Conflict',
      };
    }
    case 'P2025':
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'The requested record was not found',
        error: 'Not Found',
      };
    case 'P2003':
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'This action references a record that does not exist',
        error: 'Bad Request',
      };
    case 'P2000':
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'One of the provided values is too long for its field',
        error: 'Bad Request',
      };
    default:
      return null;
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  //* NEVER LEAK RAW ERROR DETAILS (SCHEMA NAMES, STACK TRACES) TO A PRODUCTION
  //* CLIENT — BUT IN DEV/LOCAL, SURFACING THE REAL MESSAGE SAVES A TRIP TO
  //* THE LOG FILE FOR EVERY UNEXPECTED 500.
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    //* OPTIONAL STABLE IDENTIFIER THE CLIENT CAN BRANCH ON (E.G. REFRESH THE TOKEN ON
    //* AUTH_TOKEN_EXPIRED VS. HARD LOGOUT ON AUTH_TOKEN_INVALID). ONLY EMITTED WHEN THE
    //* THROWER SUPPLIED ONE, SO EXISTING RESPONSES KEEP THEIR CURRENT SHAPE.
    let errorCode: string | undefined;
    //* SECONDS THE CLIENT MUST WAIT, MIRRORED INTO THE BODY FROM THE Retry-After HEADER.
    //* THE HEADER ALONE IS NOT ENOUGH FOR THIS APP'S FRONTEND: ITS AXIOS INTERCEPTOR
    //* NORMALISES EVERY FAILURE DOWN TO A PLAIN OBJECT BUILT FROM response.data, SO A
    //* HEADER-ONLY VALUE IS DROPPED BEFORE ANY SCREEN COULD COUNT DOWN WITH IT.
    let retryAfter: number | undefined;

    //* ORDER IS LOAD-BEARING: TokenExpiredError EXTENDS JsonWebTokenError, SO THE
    //* SUBCLASS MUST BE TESTED FIRST OR EXPIRY IS SWALLOWED BY THE PARENT BRANCH
    //* AND REPORTED AS "INVALID TOKEN" — WHICH WOULD TELL THE CLIENT TO HARD-LOGOUT
    //* INSTEAD OF REFRESHING.
    if (exception instanceof TokenExpiredError) {
      statusCode = HttpStatus.UNAUTHORIZED;
      message = 'Token expired';
      error = (exception as Error).message;
      errorCode = 'AUTH_TOKEN_EXPIRED';
    } else if (exception instanceof JsonWebTokenError) {
      statusCode = HttpStatus.UNAUTHORIZED;
      message = 'Invalid token';
      error = (exception as Error).message;
      errorCode = 'AUTH_TOKEN_INVALID';
    } else if (exception instanceof BadRequestException) {
      const validationErrors = exception.getResponse() as {
        message?: string | ValidationError[];
      };
      if (
        Array.isArray(validationErrors.message) &&
        validationErrors.message[0] instanceof ValidationError
      ) {
        statusCode = HttpStatus.BAD_REQUEST;
        message = formatValidationErrors(validationErrors.message);
        error = 'Validation Error';
      } else {
        statusCode = HttpStatus.BAD_REQUEST;
        message = (validationErrors.message as string) || 'Validation failed';
        error = 'Bad Request';
      }
    } else if (exception instanceof ThrottlerException) {
      //* ORDER IS LOAD-BEARING FOR THE SAME REASON AS TokenExpiredError ABOVE:
      //* ThrottlerException EXTENDS HttpException, SO PLACED AFTER THE GENERIC BRANCH THIS
      //* WOULD BE UNREACHABLE AND THE CLIENT WOULD GET THE LIBRARY'S RAW DEFAULT MESSAGE,
      //* "ThrottlerException: Too Many Requests" — A LEAKED INTERNAL CLASS NAME IN A
      //* USER-FACING, UNTRANSLATABLE STRING. SEE docs/concepts/rate-limiting.md §2.9.
      //* AppThrottlerGuard HAS ALREADY SET Retry-After AND THE X-RateLimit-* HEADERS ON
      //* THE RESPONSE BY THIS POINT; response.status().json() BELOW KEEPS THEM.
      statusCode = HttpStatus.TOO_MANY_REQUESTS;

      //* PASS THE GUARD'S SENTENCE THROUGH INSTEAD OF FLATTENING IT BACK TO A GENERIC
      //* ONE. IT IS THE ONLY VERSION THAT KNOWS WHICH TIER TRIPPED AND HOW LONG THE WAIT
      //* IS — "Too many requests. Please try again later." USED TO OVERWRITE EXACTLY THAT
      //* AND IS WHAT MADE THE 429 UNREADABLE TO A NORMAL USER.
      //*
      //* THE FALLBACK STILL MATTERS: A ThrottlerException THROWN ANYWHERE OTHER THAN OUR
      //* GUARD CARRIES THE LIBRARY DEFAULT, WHICH IS THE LEAKED CLASS NAME THIS BRANCH
      //* EXISTS TO KEEP OFF A USER'S SCREEN IN THE FIRST PLACE.
      const throttlerMessage = exception.message;
      message =
        throttlerMessage && !throttlerMessage.startsWith('ThrottlerException')
          ? throttlerMessage
          : 'You have tried too many times. Please wait a moment and try again.';

      error = 'Too Many Requests';
      errorCode = 'RATE_LIMIT_EXCEEDED';

      //* READ BACK WHAT THE GUARD SET RATHER THAN RECOMPUTING IT — THERE IS ONLY ONE
      //* SOURCE OF THIS NUMBER AND IT IS THE THROTTLER'S OWN timeToBlockExpire.
      const retryAfterHeader = response.getHeader('Retry-After');
      const parsed = Number(retryAfterHeader);
      retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    } else if (exception instanceof HttpException) {
      //* GENERIC FALLBACK FOR EVERY HttpException SUBCLASS (BUILT-IN OR CUSTOM) —
      //* COVERS ANY CURRENT OR FUTURE EXCEPTION WITHOUT NEEDING ITS OWN NAMED BRANCH HERE
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as Record<string, unknown>;
        message = (responseObj['message'] as string) || exception.message;
        error = (responseObj['error'] as string) || exception.message;
        if (typeof responseObj['errorCode'] === 'string') {
          errorCode = responseObj['errorCode'];
        }
      } else {
        message = exceptionResponse;
        error = exceptionResponse;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      if (mapped) {
        statusCode = mapped.statusCode;
        message = mapped.message;
        error = mapped.error;
      } else if (!this.isProduction) {
        const lines = exception.message.split('\n').map((l) => l.trim());
        message = lines.filter(Boolean).pop() || exception.message;
        error = `Database Error (${exception.code})`;
      }
    } else if (!this.isProduction && exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    if ((statusCode as number) >= 500) {
      const logMessage = Array.isArray(message) ? message.join(', ') : message;
      this.logger.error(
        `Unhandled Exception [${statusCode}]: ${logMessage}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(statusCode).json({
      statusCode,
      success: false,
      message,
      error,
      ...(errorCode ? { errorCode } : {}),
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
