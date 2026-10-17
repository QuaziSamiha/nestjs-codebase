import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsUrl,
  IsDateString,
  MaxLength,
  IsObject,
  MinLength,
} from 'class-validator';

export class CreateProfileDto {
  @ApiProperty({
    description: 'First name of the user',
    example: 'Jane Doe',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1, { message: 'First name must be at least 1 character long' })
  @MaxLength(100, { message: 'First name must be at most 100 characters long' })
  firstName!: string;

  @ApiProperty({ description: 'Last name of the user', example: 'Tasnim' })
  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'Last name must be at most 100 characters long' })
  lastName?: string;

  @ApiPropertyOptional({
    description: 'URL of the user avatar',
    example: 'https://example.com/avatar.jpg',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Avatar must be a valid URL' })
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'User bio',
    example: 'Software developer with 5 years experience',
  })
  @IsString()
  @IsOptional()
  bio?: string;

  @ApiPropertyOptional({ description: 'Date of birth', example: '1990-01-01' })
  @IsOptional()
  @IsDateString({}, { message: 'Date of birth must be a valid date string' })
  dateOfBirth?: Date;

  @ApiPropertyOptional({ description: 'Gender', example: 'Male' })
  @IsString()
  @IsOptional()
  @MaxLength(20, { message: 'Gender must be at most 20 characters long' })
  gender?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the profile',
    example: { interests: ['sports', 'music'], location: 'New York' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
