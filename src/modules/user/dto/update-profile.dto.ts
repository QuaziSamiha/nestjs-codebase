import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsPhoneNumber,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'First name', example: 'Jane' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'First name must be at least 1 character long' })
  @MaxLength(100, { message: 'First name must be at most 100 characters long' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name', example: 'Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Last name must be at most 100 characters long' })
  lastName?: string;

  @ApiPropertyOptional({
    description:
      'Phone number in international (E.164) format, including the country code. Spaces, dashes and parentheses are stripped.',
    example: '+14155552671',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @IsPhoneNumber(undefined, {
    message:
      'Phone must be a valid international number including the country code, e.g. +14155552671',
  })
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Profile picture (avatar) image file',
  })
  @IsOptional()
  avatar?: Express.Multer.File;

  @ApiPropertyOptional({
    description:
      'Set to true to remove the current profile photo. Ignored if a new avatar file is also uploaded.',
    example: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'removeAvatar must be either true or false' })
  removeAvatar?: boolean;
}
