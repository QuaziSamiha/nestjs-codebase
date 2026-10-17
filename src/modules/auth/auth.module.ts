import { forwardRef, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from '../user/user.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import authConfig from './config/auth.config';
import { HashModule } from '../../shared/hash/hash.module';

@Module({
  imports: [
    //* PARTIAL REGISTRATION — AUTHMODULE OWNS THE 'AUTH' CONFIG NAMESPACE
    //* INSTEAD OF RELYING ON A SHARED GLOBAL CONFIG FOLDER
    ConfigModule.forFeature(authConfig),
    HashModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        //* READS FROM THE SAME 'AUTH' NAMESPACE AS JWTSTRATEGY AND AUTHSERVICE
        secret: config.get<string>('auth.accessSecret'),
        signOptions: { expiresIn: config.get('auth.accessExpiresIn') },
      }),
      inject: [ConfigService],
    }),
    //* forwardRef: OtpModule NOW IMPORTS AuthModule (verifyOtp MINTS A SESSION
    //* AFTER A SIGNUP CODE IS BURNED), CLOSING THE LOOP
    //* UserModule → OtpModule → AuthModule → UserModule. WITHOUT THIS, THE
    //* UserModule BINDING IS STILL undefined WHEN AuthModule IS EVALUATED.
    forwardRef(() => UserModule),
    PrismaModule,
  ],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
