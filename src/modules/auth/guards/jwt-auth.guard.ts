//* THE ONLY ENTRY POINT (GLOBAL)
import {
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/auth/public.decorator';
import { User } from '../../../generated/prisma/client';

//* STABLE, MACHINE-READABLE CODES THE CLIENT BRANCHES ON. THE RAW STRINGS
//* PASSPORT-JWT PUTS IN `info` ("No auth token", "jwt expired") ARE LIBRARY
//* INTERNALS — THEY CAN CHANGE ON ANY DEPENDENCY UPGRADE, SO THEY MUST NEVER
//* BECOME PART OF THE PUBLIC API CONTRACT.
export type AuthErrorCode =
  | 'AUTH_TOKEN_MISSING'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_UNAUTHORIZED';

//* TRANSLATES PASSPORT'S `info` INTO A CODE FOR THE CLIENT PLUS A MESSAGE THAT
//* IS SAFE TO RENDER DIRECTLY TO A NORMAL USER. MATCHING ON error.name FIRST IS
//* MORE DURABLE THAN MATCHING ON THE MESSAGE TEXT — jsonwebtoken KEEPS THE CLASS
//* NAMES STABLE BUT REWORDS THE MESSAGES BETWEEN RELEASES.
function mapAuthError(info: unknown): {
  errorCode: AuthErrorCode;
  message: string;
} {
  const name = info instanceof Error ? info.name : '';
  const raw = info instanceof Error ? info.message : '';

  if (name === 'TokenExpiredError') {
    return {
      errorCode: 'AUTH_TOKEN_EXPIRED',
      message: 'Your session has expired. Please log in again.',
    };
  }

  //* JsonWebTokenError COVERS "invalid signature", "jwt malformed", "invalid token";
  //* NotBeforeError IS A TOKEN USED BEFORE ITS nbf CLAIM — BOTH MEAN THE SAME THING
  //* TO A USER: THE CREDENTIAL CANNOT BE TRUSTED, SO CLEAR IT AND SIGN IN AGAIN.
  if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
    return {
      errorCode: 'AUTH_TOKEN_INVALID',
      message: 'Your session is invalid. Please log in again.',
    };
  }

  //* NO name TO MATCH ON — PASSPORT REPORTS A MISSING HEADER/COOKIE WITH A PLAIN Error
  if (raw === 'No auth token') {
    return {
      errorCode: 'AUTH_TOKEN_MISSING',
      message: 'Please log in to continue.',
    };
  }

  return {
    errorCode: 'AUTH_UNAUTHORIZED',
    message: 'Authentication failed. Please log in again.',
  };
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  //* MAIN GATEKEEPER LOGIC.
  //* CHECKS FOR THE @Public() DECORATOR AND ATTEMPTS JWT VALIDATION.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    try {
      //* ATTEMPT STANDARD PASSPORT-JWT VALIDATION
      return (await super.canActivate(context)) as boolean;
    } catch (err: unknown) {
      //* IF THE ROUTE IS MARKED @Public(), WE IGNORE AUTHENTICATION ERRORS
      if (isPublic) {
        return true;
      }

      //* handleRequest BELOW ALREADY THREW A FULLY-SHAPED EXCEPTION CARRYING errorCode —
      //* RE-WRAPPING IT AS UnauthorizedException(err.message) WOULD FLATTEN IT BACK TO A
      //* BARE STRING AND THROW THE CODE AWAY, SO PASS ANY HttpException THROUGH UNTOUCHED.
      if (err instanceof HttpException) {
        throw err;
      }

      throw new UnauthorizedException({
        message: 'Authentication failed. Please log in again.',
        error: 'Unauthorized',
        errorCode: 'AUTH_UNAUTHORIZED' satisfies AuthErrorCode,
      });
    }
  }

  //* FINALIZES THE REQUEST BY ATTACHING THE USER OR THROWING AN EXCEPTION.
  //* WE USE THE GENERIC <TUser = any> TO MATCH THE BASE CLASS SIGNATURE.
  handleRequest<TUser = User>(err: any, user: any, info: any): TUser {
    //* IF THERE IS AN ERROR OR NO USER
    if (err || !user) {
      //* THE STRATEGY'S validate() MAY REJECT WITH ITS OWN DELIBERATE EXCEPTION
      //* (E.G. "ACCOUNT DISABLED") — THAT MESSAGE IS ALREADY USER-FACING, KEEP IT.
      if (err instanceof HttpException) {
        throw err;
      }

      const { errorCode, message } = mapAuthError(info);
      throw new UnauthorizedException({
        message,
        error: 'Unauthorized',
        errorCode,
      });
    }

    //* CAST TO TUser (WHICH DEFAULTS TO YOUR PRISMA User)
    return user as TUser;
  }
}
