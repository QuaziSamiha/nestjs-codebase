import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { OTPType } from '../../../generated/prisma/enums';

export class ResendOtpDto {
  @ApiProperty({
    example: 'jane.doe@example.com',
    description: 'The email address to resend the verification code to',
    format: 'email',
  })
  @IsNotEmpty({ message: 'The identifier (email) is required' })
  @IsString({ message: 'Identifier must be a valid string' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  identifier!: string;

  @ApiProperty({
    enum: OTPType,
    example: OTPType.SIGNUP,
    description: 'The purpose of the OTP (e.g., SIGNUP, PASSWORD_RESET)',
  })
  @IsEnum(OTPType, {
    message: `Invalid OTP type. Must be one of: ${Object.values(OTPType).join(', ')}`,
  })
  @IsNotEmpty({
    message: 'The OTP type is required to resend the correct code',
  })
  type!: OTPType;
}
