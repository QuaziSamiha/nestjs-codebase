import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

//* THE OTP IS THE ONLY CREDENTIAL IN THIS PAYLOAD — THERE IS NO SEPARATE
//* "RESET TOKEN". THAT IS DELIBERATE AND MATCHES THE SCHEMA: UserSecurity's
//* resetToken/resetTokenExpires COLUMNS WERE DROPPED (MIGRATION
//* 20260813085902_drop_unused_user_security_tokens) SO THAT EVERY VERIFICATION
//* FLOW RUNS THROUGH THE `OTP` MODEL AND NOTHING ELSE. THE PRACTICAL EFFECT IS
//* THAT PROOF-OF-OWNERSHIP AND THE PASSWORD WRITE HAPPEN IN THE SAME REQUEST,
//* SO NO LONGER-LIVED CAPABILITY EVER SITS IN THE BROWSER BETWEEN THE TWO.
export class ResetPasswordDto {
  @ApiProperty({
    description: 'The email address the reset code was sent to',
    example: 'jane.doe@example.com',
    format: 'email',
  })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  @ApiProperty({
    description: 'The 6-digit reset code emailed to the account',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsNotEmpty({ message: 'The reset code cannot be empty' })
  @IsString({ message: 'The reset code must be a string' })
  @Length(6, 6, { message: 'The reset code must be exactly 6 characters long' })
  @Matches(/^\d+$/, { message: 'The reset code must contain only numbers' })
  code!: string;

  @ApiProperty({
    description: 'The new password to set',
    example: 'NewP@ssw0rd123!',
  })
  @IsNotEmpty()
  @IsString()
  //* SAME FLOOR AS CreateUserDto/UpdatePasswordDto. KEEP THESE THREE IN STEP —
  //* A RESET PATH THAT ACCEPTS A WEAKER PASSWORD THAN REGISTRATION IS JUST A
  //* WAY AROUND THE REGISTRATION RULE.
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  @MaxLength(255, { message: 'Password must be at most 255 characters long' })
  newPassword!: string;
}
