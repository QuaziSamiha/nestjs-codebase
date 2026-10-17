import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

//* THE ENTIRE PAYLOAD IS ONE EMAIL ON PURPOSE. ANYTHING ELSE A CALLER COULD
//* SEND HERE (A USER ID, A ROLE, A REDIRECT TARGET) WOULD BE UNAUTHENTICATED
//* INPUT STEERING AN EMAIL THAT LANDS IN SOMEBODY ELSE'S INBOX.
export class ForgotPasswordDto {
  @ApiProperty({
    description: 'The email address of the account to reset',
    example: 'jane.doe@example.com',
    format: 'email',
  })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(100, { message: 'Email must be at most 100 characters long' })
  //* SAME NORMALIZATION AS CreateUserDto/LoginDto — CASE-INSENSITIVE
  //* UNIQUENESS IS ENFORCED BY ALWAYS STORING/COMPARING LOWERCASE.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;
}
