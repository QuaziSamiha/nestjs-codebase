import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'The email address of the user',
    example: 'jane.doe@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(100, { message: 'Email must be at most 100 characters long' })
  //* NORMALIZED THE SAME WAY AS CreateUserDto.email SO A DIFFERENTLY-CASED
  //* LOGIN ATTEMPT STILL MATCHES THE STORED (LOWERCASE) ROW.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  @ApiProperty({
    description: 'The password of the user',
    example: 'meowmeow',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  @MaxLength(255, { message: 'Password must be at most 255 characters long' })
  password!: string;
}
