import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { TokensResponseDto } from './dto/token-response.dto';
import type { Request, Response } from 'express';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SocialAuthDto } from './dto/third-partry-auth.dto';
import { ResponseMessage } from '../../common/decorators/response/response-message.decorator';
import {
  LOGIN_THROTTLE,
  REFRESH_THROTTLE,
  THROTTLER_SHORT,
} from '../../common/throttler/throttler.constants';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}
  private readonly logger = new Logger(AuthController.name);

  //* THE MOST ATTACKED ROUTE IN THE APP AND THE MOST EXPENSIVE ONE TO CALL — EVERY ATTEMPT
  //* COSTS A BCRYPT COMPARE. 5 PER MINUTE PER IP, THEN A 15-MINUTE BLOCK; blockDuration IS
  //* WHAT MAKES THE PENALTY OUTLAST THE WINDOW SO AN ATTACKER CAN'T JUST WAIT OUT ONE ttl
  //* AND RESUME AT FULL RATE. THIS IS THE PER-IP LAYER ONLY — PER-ACCOUNT LOCKOUT, WHICH IS
  //* WHAT ACTUALLY STOPS CREDENTIAL STUFFING SPREAD ACROSS MANY IPs, IS NOT IMPLEMENTED
  //* YET (UserSecurity.loginAttempts IS STILL WRITE-ONLY). SEE §7.2 OF
  //* docs/concepts/rate-limiting.md.
  @Throttle({ [THROTTLER_SHORT]: LOGIN_THROTTLE })
  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticates user and returns JWT tokens',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: TokensResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'Refresh token in HTTP-only cookie',
        schema: { type: 'string' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @HttpCode(200)
  @ResponseMessage('Login successful')
  async login(
    @Body() loginDto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.debug(`Login attempt for ${loginDto.email}`);
    const tokens = await this.authService.login(loginDto, ip);
    this.logger.log(`Successful login for ${loginDto.email}`);
    this.setRefreshTokenCookie(res, tokens.refresh_token);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // Include refresh token in response
    };
  }

  @Post('social-auth')
  @ApiOperation({
    summary: 'Social login (Google, Facebook, Apple)',
    description:
      'Logs in the matching account, or silently registers one from a verified OAuth identity, then returns JWT tokens.',
  })
  @ApiBody({ type: SocialAuthDto })
  @ApiResponse({
    status: 200,
    description: 'Social login successful',
    type: TokensResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'Refresh token in HTTP-only cookie',
        schema: { type: 'string' },
      },
    },
  })
  @ApiForbiddenResponse({ description: 'Account is blocked or suspended' })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @HttpCode(200)
  @ResponseMessage('Login successful')
  async socialAuth(
    @Body() socialAuthDto: SocialAuthDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.debug(`Social login attempt via ${socialAuthDto.provider}`);
    const tokens = await this.authService.socialAuth(socialAuthDto, ip);
    this.logger.log(`Successful social login via ${socialAuthDto.provider}`);
    this.setRefreshTokenCookie(res, tokens.refresh_token);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  //* LEGITIMATE CLIENTS REFRESH RARELY — A BURST HERE IS A TOKEN-REPLAY LOOP, NOT A USER.
  //* NO blockDuration: A BUGGY-BUT-HONEST CLIENT STUCK IN A REFRESH LOOP SHOULD RECOVER ON
  //* ITS OWN ONCE THE WINDOW ROLLS, NOT GET ITS SESSION HARD-KILLED FOR 15 MINUTES.
  @Throttle({ [THROTTLER_SHORT]: REFRESH_THROTTLE })
  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Generates new access token using refresh token (can be provided via cookie or request body)',
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    type: TokensResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired refresh token',
    content: {
      'application/json': {
        example: {
          statusCode: 401,
          message: 'Invalid refresh token',
        },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'Access denied',
    content: {
      'application/json': {
        example: {
          statusCode: 403,
          message: 'Forbidden resource',
        },
      },
    },
  })
  @ApiCookieAuth('refreshToken')
  @ApiBody({
    type: RefreshTokenDto,
    description: 'Optional refresh token in body (if not using cookie)',
    required: false,
  })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Token refreshed successfully')
  async refresh(
    @Req() req: Request,
    @Body() refreshTokenDto?: RefreshTokenDto,
  ) {
    const cookies = req.cookies as Record<string, string | undefined>;
    const refreshToken = cookies?.refreshToken || refreshTokenDto?.refreshToken;

    if (!refreshToken) {
      throw new BadRequestException('No refresh token provided');
    }

    return this.authService.refreshToken(refreshToken);
  }

  private setRefreshTokenCookie(res: Response, refreshToken: string): void {
    const authConfig = this.configService.get('auth');
    const refreshTokenExpires = authConfig?.refreshExpiresInMs;

    // parseInt will stop at the first non-numeric character (like a space or #)
    const maxAge = parseInt(refreshTokenExpires, 10);
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: authConfig?.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: isNaN(maxAge) ? Number(authConfig?.refreshExpiresInMs) : maxAge,
    });
  }
}
