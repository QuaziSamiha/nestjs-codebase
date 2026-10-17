import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { OTPType } from '../../../generated/prisma/enums';

export class VerifyOtpDto {
  @ApiProperty({
    example: 'jane.doe@example.com',
    description:
      'The email address or phone number that received the verification code',
    format: 'email',
  })
  @IsNotEmpty({ message: 'The identifier (email) is required' })
  @IsString({ message: 'Identifier must be a valid string' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  identifier!: string;

  @ApiProperty({
    example: '123456',
    description: 'The 6-digit numeric code sent to the user',
    minLength: 6,
    maxLength: 6,
  })
  @IsNotEmpty({ message: 'The OTP code cannot be empty' })
  @IsString({ message: 'The OTP code must be a string' })
  @Length(6, 6, { message: 'The OTP must be exactly 6 characters long' })
  @Matches(/^\d+$/, { message: 'The OTP must contain only numbers' }) // Ensures numeric string
  code!: string;

  @ApiProperty({
    enum: OTPType,
    example: OTPType.SIGNUP,
    description: 'The purpose of the OTP (e.g., SIGNUP, PASSWORD_RESET)',
  })
  @IsEnum(OTPType, {
    message: `Invalid OTP type. Must be one of: ${Object.values(OTPType).join(', ')}`,
  })
  @IsNotEmpty({
    message: 'The OTP type is required to verify the correct action',
  })
  type!: OTPType;
}
