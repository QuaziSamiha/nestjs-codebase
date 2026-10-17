import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../shared/hash/hash.service';
import { AuthProvider } from '../../generated/prisma/enums';
import { assertAccountCanAuthenticate } from '../../common/utils/account-status.util';
import { UserResponseDto } from '../user/dto/user-response.dto';
// import type { SignOptions } from 'jsonwebtoken';
import { IJwtPayload, ITokens } from './interfaces/jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { TokensResponseDto } from './dto/token-response.dto';
import {
  SocialAuthDto,
  VerifiedSocialProfile,
} from './dto/third-partry-auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;

  constructor(
    //* forwardRef: UserModule → OtpModule → AuthModule → UserModule IS NOW A
    //* CYCLE (SEE auth.module.ts), SO THE UserService BINDING IS UNDEFINED AT
    //* THE TIME THIS CONSTRUCTOR IS EVALUATED WITHOUT A LAZY REFERENCE.
    @Inject(forwardRef(() => UserService))
    private userService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private hashService: HashService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('auth.googleClientId'),
    );
  }

  async validateUser(
    email: string,
    password: string,
    ip?: string,
  ): Promise<UserResponseDto> {
    const user = await this.userService.findForAuth(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    //* STATUS GATE BEFORE THE PASSWORD COMPARE — A DEACTIVATED (SOFT-DELETED),
    //* BLOCKED, SUSPENDED OR UNVERIFIED ACCOUNT IS REJECTED EVEN WITH THE
    //* CORRECT CREDENTIALS. SEE assertAccountCanAuthenticate.
    assertAccountCanAuthenticate(user.status);

    // * Check for password (OAuth users won't have one)
    if (!user.password) {
      throw new UnauthorizedException(
        'Password not set. Please use third-party (Google, Facebook) login.',
      );
    }

    const isMatch = await this.hashService.compare(password, user.password);
    if (!isMatch) {
      await this.userService.updateLoginAttempts(user.id); // * Increment failed attempts
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.userService.updateLoginSuccess(user.id, ip);
    await this.userService.updateLastLoginTime(user.id);

    // const loginPayload = {
    //   id: user.id,
    //   email: user.email,
    //   role: user.role,
    // };
    // return loginPayload;
    return new UserResponseDto({
      id: user.id,
      sid: user.sid,
      email: user.email,
      phone: user.phone ?? undefined,
      role: user.role,
      status: user.status,
      authProvider: user.authProvider,
      providerId: user.providerId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  async login(loginDto: LoginDto, ip?: string): Promise<TokensResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password, ip);

    const payload: IJwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const tokens = await this.generateTokens(payload);
    return new TokensResponseDto(tokens);
  }

  //* ISSUES A SESSION FOR A USER WHOSE IDENTITY HAS *ALREADY* BEEN PROVEN BY
  //* ANOTHER TRUSTED FLOW — CURRENTLY ONLY OtpService.verifyOtp, WHICH ONLY
  //* REACHES HERE AFTER MATCHING A HASHED, UNEXPIRED, SINGLE-USE OTP THAT WAS
  //* EMAILED TO THE ACCOUNT'S OWN ADDRESS. THAT PROOF IS EQUIVALENT TO A
  //* PASSWORD CHECK, WHICH IS WHY NO CREDENTIAL IS REQUIRED HERE.
  //*
  //* NEVER CALL THIS FROM A PATH THAT HASN'T VERIFIED OWNERSHIP OF THE
  //* ACCOUNT — IT MINTS A FULL ACCESS/REFRESH PAIR FROM NOTHING BUT A userId.
  async issueTokensForVerifiedUser(
    userId: number,
    ip?: string,
  ): Promise<TokensResponseDto> {
    const user = await this.userService.getUserById(userId);

    assertAccountCanAuthenticate(user.status);

    await this.userService.updateLoginSuccess(user.id, ip);
    await this.userService.updateLastLoginTime(user.id);

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return new TokensResponseDto(tokens);
  }

  async socialAuth(
    socialAuthDto: SocialAuthDto,
    ip?: string,
  ): Promise<TokensResponseDto> {
    const profile = await this.verifySocialToken(socialAuthDto);
    const user = await this.userService.findOrCreateSocialUser(profile, ip);

    const payload: IJwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const tokens = await this.generateTokens(payload);
    return new TokensResponseDto(tokens);
  }

  //* TURNS A CLIENT-SUPPLIED PROVIDER TOKEN INTO A TRUSTED IDENTITY. NOTHING
  //* IN THE RETURNED PROFILE COMES FROM THE REQUEST BODY DIRECTLY — IT IS ALL
  //* READ BACK OUT OF THE PROVIDER'S OWN VERIFIED TOKEN PAYLOAD, SO A CALLER
  //* CANNOT CLAIM AN IDENTITY (email/providerId) THEY DON'T ACTUALLY OWN.
  private async verifySocialToken(
    dto: SocialAuthDto,
  ): Promise<VerifiedSocialProfile> {
    switch (dto.provider) {
      case AuthProvider.GOOGLE:
        return this.verifyGoogleIdToken(dto.idToken);
      case AuthProvider.FACEBOOK:
      case AuthProvider.APPLE:
        throw new BadRequestException(
          `Social login via ${dto.provider} is not supported yet`,
        );
      default:
        throw new BadRequestException('Unsupported social login provider');
    }
  }

  private async verifyGoogleIdToken(
    idToken: string,
  ): Promise<VerifiedSocialProfile> {
    const audience = this.configService.get<string>('auth.googleClientId');
    if (!audience) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured on this server',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired Google identity token',
      );
    }

    if (!payload?.email || !payload.sub) {
      throw new UnauthorizedException(
        'Google identity token is missing required claims',
      );
    }
    if (payload.email_verified === false) {
      throw new UnauthorizedException(
        'Google account email is not verified',
      );
    }

    return {
      //* NORMALIZED — SEE UserRepository's email LOOKUPS FOR WHY EMAIL IS
      //* ALWAYS LOWERCASED BEFORE IT TOUCHES A where/data CLAUSE.
      email: payload.email.toLowerCase().trim(),
      firstName: payload.given_name ?? payload.name ?? 'User',
      lastName: payload.family_name,
      providerId: payload.sub,
      provider: AuthProvider.GOOGLE,
      image: payload.picture,
    };
  }

  async refreshToken(refreshToken: string): Promise<TokensResponseDto> {
    const authConfig = this.configService.get('auth');

    //* ONLY THE SIGNATURE/EXPIRY CHECK LIVES IN THE try. THE STATUS GATE BELOW
    //* USED TO SIT INSIDE IT, SO A DEACTIVATED ACCOUNT'S 403 WAS CAUGHT AND
    //* FLATTENED INTO "invalid or expired refresh token" — MISLEADING FOR THE
    //* CLIENT AND EASY TO MISREAD AS A TOKEN BUG DURING SUPPORT.
    let payload: IJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<IJwtPayload>(refreshToken, {
        secret: authConfig?.refreshSecret,
      });
    } catch (error: unknown) {
      this.logger.warn('Refresh token validation failed', error);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    //* getUserById THROWS NotFoundException FOR A MISSING ROW — A DELETED USER
    //* PRESENTING AN OLD REFRESH TOKEN IS AN AUTH FAILURE (401), NOT A 404.
    const user = await this.userService.getUserById(payload.sub).catch(() => {
      throw new UnauthorizedException('Invalid or expired refresh token');
    });

    assertAccountCanAuthenticate(user.status);

    // 5. Generate new pair
    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return new TokensResponseDto(tokens);
  }

  private async generateTokens(payload: IJwtPayload): Promise<ITokens> {
    const authConfig = this.configService.get('auth');
    const [at, rt] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: authConfig?.accessSecret,
        expiresIn: authConfig?.accessExpiresIn,
      }),
      this.jwtService.signAsync(
        { sub: payload.sub },
        {
          secret: authConfig?.refreshSecret,
          expiresIn: authConfig?.refreshExpiresIn,
        },
      ),
    ]);

    return { access_token: at, refresh_token: rt };
  }
}
