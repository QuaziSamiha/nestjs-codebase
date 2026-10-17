import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProfileModel } from '../../../generated/prisma/models';
import { formatDisplayName } from '../../../common/utils/display-name.util';

export class ProfileResponseDto {
  @ApiProperty({ description: 'First name', example: 'John' })
  firstName: string;

  @ApiPropertyOptional({ description: 'Last name', example: 'Doe' })
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Full name, derived from firstName + lastName',
    example: 'John Doe',
  })
  name?: string;

  @ApiPropertyOptional({ description: 'Profile image URL' })
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'User bio',
    example: 'Software developer',
  })
  bio?: string;

  @ApiPropertyOptional({ description: 'Date of birth', example: '1990-01-01' })
  dateOfBirth?: Date;

  @ApiPropertyOptional({ description: 'Gender', example: 'Male' })
  gender?: string;

  constructor(profile: Partial<ProfileModel>, baseUrl?: string) {
    this.firstName = profile.firstName!;
    this.lastName = profile.lastName ?? undefined;
    this.name = formatDisplayName(profile);
    this.avatarUrl = profile.avatarUrl
      ? profile.avatarUrl.startsWith('http')
        ? profile.avatarUrl
        : `${baseUrl}${profile.avatarUrl}`
      : undefined;
    this.bio = profile.bio ?? undefined;
    // this.dateOfBirth = profile.dateOfBirth ?? undefined;
    this.dateOfBirth = profile.dateOfBirth
      ? new Date(profile.dateOfBirth)
      : undefined;
    this.gender = profile.gender ?? undefined;
  }
}
