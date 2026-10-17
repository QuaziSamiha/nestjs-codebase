import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserSecurityModel } from '../../../generated/prisma/models';

// * This is for the logged-in user viewing their own "My Account" page. It focuses on privacy.
export class UserSecurityMeResponseDto {
  @ApiProperty()
  isEmailVerified: boolean;

  @ApiPropertyOptional()
  emailVerifiedAt?: Date;

  constructor(userSecurity: Partial<UserSecurityModel>) {
    this.isEmailVerified = userSecurity.isEmailVerified!;
    this.emailVerifiedAt = userSecurity.emailVerifiedAt
      ? new Date(userSecurity.emailVerifiedAt)
      : undefined;
  }
}

// * This is for the "Admin Dashboard" where staff monitor security and manage vendors.
export class UserSecurityAdminResponseDto {
  @ApiProperty()
  isEmailVerified: boolean;

  @ApiPropertyOptional()
  emailVerifiedAt?: Date;

  @ApiPropertyOptional()
  assignedIp?: string;

  @ApiPropertyOptional()
  lastLoginIp?: string;

  @ApiProperty()
  loginAttempts: number; // Admin needs to see if someone is being brute-forced

  constructor(userSecurity: Partial<UserSecurityModel>) {
    this.isEmailVerified = !!userSecurity.isEmailVerified;
    this.emailVerifiedAt = userSecurity.emailVerifiedAt
      ? new Date(userSecurity.emailVerifiedAt)
      : undefined;
    this.assignedIp = userSecurity.assignedIp ?? undefined;
    this.lastLoginIp = userSecurity.lastLoginIp ?? undefined;
    this.loginAttempts = userSecurity.loginAttempts ?? 0;
  }
}
