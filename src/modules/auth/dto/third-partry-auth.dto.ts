// src/user/dto/social-auth.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsEnum } from 'class-validator';
import { AuthProvider } from '../../../generated/prisma/enums';

//* THE CLIENT SUPPLIES ONLY `provider` + THE RAW PROVIDER TOKEN. EVERY
//* IDENTITY FIELD (email, name, providerId, image) IS DERIVED SERVER-SIDE
//* FROM THE VERIFIED TOKEN PAYLOAD IN AuthService — NEVER TRUSTED FROM THE
//* REQUEST BODY. SEE VerifiedSocialProfile FOR THE POST-VERIFICATION SHAPE.
export class SocialAuthDto {
  @ApiProperty({ example: AuthProvider.GOOGLE, enum: AuthProvider })
  @IsEnum(AuthProvider)
  @IsNotEmpty()
  provider!: AuthProvider;

  @ApiProperty({
    description:
      "Provider-issued identity token (e.g. Google's OpenID Connect ID token) — verified server-side, not trusted as-is",
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}

//* WHAT A PROVIDER TOKEN VERIFIES TO. `provider`/`providerId` TOGETHER MUST
//* MATCH THE User.@@unique([authProvider, providerId]) CONSTRAINT'S SHAPE.
export interface VerifiedSocialProfile {
  email: string;
  firstName: string;
  lastName?: string;
  providerId: string;
  provider: AuthProvider;
  image?: string;
}
