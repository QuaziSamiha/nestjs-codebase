import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { UserRole, UserStatus } from '../../../generated/prisma/enums';

//* WHO COUNTS AS AN "ADMIN". THE TWO ROLES THAT HOLD UNRESTRICTED ACCESS —
//* RolesGuard TREATS THEM SEPARATELY, BUT AN ADMIN ASKING "HOW MANY ADMINS DO
//* WE HAVE?" MEANS BOTH.
export const ADMIN_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

//* END-USER ROLES. STAFF IS DERIVED AS "NOT AN END USER" INSTEAD OF LISTED
//* OUT, SO A ROLE ADDED TO THE SCHEMA LATER LANDS IN THE STAFF BUCKET
//* AUTOMATICALLY RATHER THAN GOING UNCOUNTED.
export const END_USER_ROLES: readonly UserRole[] = [UserRole.USER];

/**
 * Admin-facing user statistics.
 * Soft-deleted accounts are excluded from every number except `deleted`.
 */
export class UserStatsDto {
  @Expose()
  @ApiProperty({
    description: 'Every account that is not soft-deleted',
    example: 1_842,
  })
  total!: number;

  @Expose()
  @ApiProperty({
    description:
      'Soft-deleted accounts (`deletedAt` set). Reported separately — they are excluded from every other number here.',
    example: 23,
  })
  deleted!: number;

  @Expose()
  @ApiProperty({
    description:
      'Count per `UserRole`, zero-filled across the whole enum so a role nobody holds still reports `0`.',
    example: {
      SUPER_ADMIN: 1,
      ADMIN: 4,
      MANAGER: 23,
      USER: 1_814,
    },
    additionalProperties: { type: 'number' },
  })
  byRole!: Record<UserRole, number>;

  @Expose()
  @ApiProperty({
    description: 'Count per `UserStatus`, zero-filled across the whole enum.',
    example: {
      PENDING_VERIFICATION: 61,
      ACTIVE: 1_744,
      INACTIVE: 12,
      SUSPENDED: 3,
      BLOCKED: 2,
      DEACTIVATED: 20,
      ARCHIVED: 0,
    },
    additionalProperties: { type: 'number' },
  })
  byStatus!: Record<UserStatus, number>;

  @Expose()
  @ApiProperty({
    description:
      'Accounts holding unrestricted access — `ADMIN` + `SUPER_ADMIN`.',
    example: 5,
  })
  admins!: number;

  @Expose()
  @ApiProperty({
    description: 'Every role except `USER`. Includes the admins above.',
    example: 28,
  })
  staff!: number;

  @Expose()
  @ApiProperty({
    description: 'End users — role `USER`.',
    example: 1_814,
  })
  endUsers!: number;

  @Expose()
  @ApiProperty({
    description:
      'Accounts that can currently hold a session — `status = ACTIVE`. The single gate `assertAccountCanAuthenticate` allows.',
    example: 1_744,
  })
  active!: number;

  @Expose()
  @ApiProperty({
    description:
      'Accounts that have never completed email verification — the sign-up drop-off.',
    example: 61,
  })
  pendingVerification!: number;

  @Expose()
  @ApiProperty({
    description: 'Accounts with a verified email address on file.',
    example: 1_770,
  })
  verifiedEmails!: number;

  @Expose()
  @ApiProperty({
    description:
      'Accounts created within the trailing window (see `newUserWindowDays`).',
    example: 96,
  })
  newUsers!: number;

  @Expose()
  @ApiProperty({
    description: 'Length of the `newUsers` window, in days.',
    example: 30,
  })
  newUserWindowDays!: number;

  constructor(init: {
    total: number;
    deleted: number;
    byRole: Record<UserRole, number>;
    byStatus: Record<UserStatus, number>;
    admins: number;
    staff: number;
    endUsers: number;
    verifiedEmails: number;
    newUsers: number;
    newUserWindowDays: number;
  }) {
    this.total = init.total;
    this.deleted = init.deleted;
    this.byRole = init.byRole;
    this.byStatus = init.byStatus;
    this.admins = init.admins;
    this.staff = init.staff;
    this.endUsers = init.endUsers;
    this.active = init.byStatus[UserStatus.ACTIVE];
    this.pendingVerification = init.byStatus[UserStatus.PENDING_VERIFICATION];
    this.verifiedEmails = init.verifiedEmails;
    this.newUsers = init.newUsers;
    this.newUserWindowDays = init.newUserWindowDays;
  }
}
