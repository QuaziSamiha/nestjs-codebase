import {
  forwardRef,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express'; // Ensure this is imported
import { IJwtPayload } from '../interfaces/jwt-payload.interface';
import { UserService } from '../../user/user.service';
import { assertAccountCanAuthenticate } from '../../../common/utils/account-status.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    //* forwardRef: AuthModule ↔ UserModule IS A CYCLE (SEE auth.module.ts),
    //* SO THE UserService BINDING NEEDS A LAZY REFERENCE HERE TOO.
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_SECRET');

    if (!secret) {
      throw new Error(
        'JWT_ACCESS_SECRET is not defined in environment variables',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => {
          const cookies = req.cookies as Record<string, string> | undefined;
          return cookies?.access_token ?? null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  //* A JWT IS A SNAPSHOT OF THE ACCOUNT AT SIGNING TIME, SO THE CLAIMS ALONE
  //* CANNOT BE TRUSTED FOR AUTHORIZATION: WITHOUT THE LOOKUP BELOW, A USER
  //* DEACTIVATED (SOFT-DELETED) BY AN ADMIN KEEPS FULL ACCESS UNTIL THEIR
  //* ACCESS TOKEN EXPIRES, AND A DEMOTED ADMIN KEEPS THE ADMIN ROLE JUST AS
  //* LONG. ONE INDEXED PK READ PER REQUEST BUYS IMMEDIATE REVOCATION.
  async validate(payload: IJwtPayload) {
    if (!payload.sub || !payload.email || !payload.role) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.userService.getAuthStateById(payload.sub);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException(
        'Your session is no longer valid. Please log in again.',
      );
    }

    //* THROWS 403 FOR DEACTIVATED/BLOCKED/SUSPENDED — JwtAuthGuard PASSES A
    //* DELIBERATE HttpException FROM HERE STRAIGHT THROUGH, SEE handleRequest.
    assertAccountCanAuthenticate(user.status);

    // * This object becomes 'req.user' — role/email come from the DB, not the
    // * token, so a role or email change takes effect on the very next request.
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
