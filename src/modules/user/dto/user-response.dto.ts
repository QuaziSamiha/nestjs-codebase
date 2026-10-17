import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  AuthProvider,
  UserRole,
  UserStatus,
} from '../../../generated/prisma/client';
import { ProfileResponseDto } from './profile-response.dto';
import { UserSecurityMeResponseDto } from './user-security-response.dto';
import {
  ProfileModel,
  UserModel,
  UserSecurityModel,
} from '../../../generated/prisma/models';
import { formatDisplayName } from '../../../common/utils/display-name.util';

export class UserResponseDtoWithDetails {
  @ApiProperty({ description: 'User ID', example: 1 })
  id!: number;

  @ApiProperty({
    description: 'User SID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sid!: string;

  @ApiProperty({ description: 'User email', example: 'jane.doe@example.com' })
  email!: string;

  @ApiPropertyOptional({ description: 'User phone', example: '+8801750256844' })
  phone?: string;

  @ApiProperty({
    enum: UserRole,
    description: 'User role',
    example: UserRole.USER,
  })
  role!: UserRole;

  @ApiProperty({
    enum: UserStatus,
    description: 'User status',
    example: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @ApiProperty({
    enum: AuthProvider,
    description: 'Authentication provider',
    example: AuthProvider.EMAIL,
  })
  authProvider!: AuthProvider;

  @ApiPropertyOptional({ description: 'Provider ID for OAuth' })
  providerId?: string;

  @ApiProperty({ type: ProfileResponseDto })
  profile!: ProfileResponseDto;

  @ApiProperty({ type: UserSecurityMeResponseDto })
  security!: UserSecurityMeResponseDto;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: Date;

  @ApiPropertyOptional({ description: 'Last login timestamp' })
  lastLoginAt?: Date;

  constructor(
    user: Partial<UserModel> & {
      profile?: Partial<ProfileModel> | null;
      security?: Partial<UserSecurityModel> | null;
      lastLoginAt?: Date | string | null;
    },
    baseUrl?: string,
  ) {
    this.id = user.id!;
    this.sid = user.sid!;
    this.email = user.email!;
    this.phone = user.phone ?? undefined;
    this.role = user.role!;
    this.status = user.status!;
    this.authProvider = user.authProvider!;
    this.providerId = user.providerId ?? undefined;
    this.createdAt = user.createdAt!;
    this.updatedAt = user.updatedAt!;
    this.lastLoginAt = user.lastLoginAt
      ? new Date(user.lastLoginAt)
      : undefined;

    if (user.profile) {
      this.profile = new ProfileResponseDto(user.profile, baseUrl);
    }

    if (user.security) {
      this.security = new UserSecurityMeResponseDto(user.security);
    }
  }
}

export class UserResponseDto {
  @ApiProperty({ description: 'User ID', example: 1 })
  id!: number;

  @ApiProperty({
    description: 'User SID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sid!: string;

  @ApiProperty({ description: 'User email', example: 'john.doe@example.com' })
  email!: string;

  @ApiPropertyOptional({ description: 'User phone', example: '+8801750256844' })
  phone?: string;

  @ApiProperty({
    enum: UserRole,
    description: 'User role',
    example: UserRole.USER,
  })
  role!: UserRole;

  @ApiProperty({
    enum: UserStatus,
    description: 'User status',
    example: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @ApiProperty({
    enum: AuthProvider,
    description: 'Authentication provider',
    example: AuthProvider.EMAIL,
  })
  authProvider!: AuthProvider;

  @ApiPropertyOptional({ description: 'Provider ID for OAuth' })
  providerId?: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: Date;

  @ApiPropertyOptional({ description: 'Last login timestamp' })
  lastLoginAt?: Date;

  constructor(user: Partial<UserModel>) {
    this.id = user.id!;
    this.sid = user.sid!;
    this.email = user.email!;
    this.phone = user.phone ?? undefined;
    this.role = user.role!;
    this.status = user.status!;
    this.authProvider = user.authProvider!;
    this.providerId = user.providerId ?? undefined;
    this.createdAt = user.createdAt!;
    this.updatedAt = user.updatedAt!;
    this.lastLoginAt = user.lastLoginAt
      ? new Date(user.lastLoginAt)
      : undefined;
  }
}

export interface MinifiedUser {
  id?: number;
  email?: string;
  status?: UserStatus;
  role?: UserRole;
  profile?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

export class UserMinifiedResponseDto {
  @Expose()
  @ApiProperty({ description: 'Internal user ID', example: 1 })
  id!: number;

  @Expose()
  @ApiProperty({
    description: 'Full name from profile',
    example: 'Jane Doe',
  })
  name!: string;

  @Expose()
  @ApiProperty({
    description: 'User email address',
    example: 'jane.doe@example.com',
  })
  email!: string;

  @Expose()
  @ApiProperty({
    enum: UserRole,
    description: 'Assigned role',
    example: UserRole.ADMIN,
  })
  role!: UserRole;

  @Expose()
  @ApiProperty({
    enum: UserStatus,
    description: 'Current account status',
    example: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  constructor(user: MinifiedUser) {
    this.id = user.id!;
    this.name = formatDisplayName(user?.profile) ?? '';
    this.email = user.email ?? '';
    this.role = user.role!;
    this.status = user.status ?? UserStatus.ACTIVE;
  }
}
