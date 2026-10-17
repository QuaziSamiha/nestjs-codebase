import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseRepository } from '../../../prisma/base.repository';
import { Prisma, UserStatus } from '../../../generated/prisma/client';
import { UserRole } from '../../../generated/prisma/enums';
import {
  PaginationService,
  PaginationQueryDto,
} from '../../../shared/pagination';

@Injectable()
export class UserRepository extends BaseRepository {
  constructor(
    prisma: PrismaService,
    private readonly paginationService: PaginationService,
  ) {
    super(prisma);
  }

  private readonly PROFILE_SELECT = {
    firstName: true,
    lastName: true,
    avatarUrl: true,
    bio: true,
    dateOfBirth: true,
    gender: true,
    metadata: true,
  } as const;

  private readonly SECURITY_SELECT_SELF = {
    isEmailVerified: true,
    emailVerifiedAt: true,
  } as const;

  private readonly SECURITY_SELECT_ADMIN = {
    isEmailVerified: true,
    emailVerifiedAt: true,
    loginAttempts: true,
    lastLoginIp: true,
    assignedIp: true,
  } as const;

  private readonly FULL_USER_SELECT_SELF = {
    id: true,
    sid: true,
    email: true,
    phone: true,
    role: true,
    status: true,
    authProvider: true,
    providerId: true,
    profile: { select: this.PROFILE_SELECT },
    security: { select: this.SECURITY_SELECT_SELF },
    createdAt: true,
    updatedAt: true,
    lastLoginAt: true,
  } as const;

  private readonly FULL_USER_SELECT_ADMIN = {
    id: true,
    sid: true,
    email: true,
    phone: true,
    role: true,
    status: true,
    authProvider: true,
    providerId: true,
    profile: { select: this.PROFILE_SELECT },
    security: { select: this.SECURITY_SELECT_ADMIN },
    createdAt: true,
    updatedAt: true,
    lastLoginAt: true,
  } as const;

  private readonly USER_SELECT = {
    id: true,
    sid: true,
    email: true,
    phone: true,
    role: true,
    status: true,
    authProvider: true,
    providerId: true,
    createdAt: true,
    updatedAt: true,
    lastLoginAt: true,
  } as const;

  async createUser(
    data: Prisma.UserCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await client.user.create({ data, select: this.USER_SELECT });
  }

  //* SAME CREATE AS ABOVE BUT RETURNS THE FULL SELF-TIER SHAPE, SO A
  //* CALLER PASSING NESTED `profile.create` / `security.create` GETS THE WHOLE
  //* AGGREGATE BACK FROM THE ONE STATEMENT INSTEAD OF WRITING THE THREE ROWS
  //* SEPARATELY AND THEN RE-READING THEM WITH findUserByEmailWithDetails.
  //* SEE UserService.registerUser. SECURITY TIER IS DELIBERATELY THE SELF
  //* ONE (NO assignedIp/loginAttempts/lastLoginIp) — THIS FEEDS THE PUBLIC
  //* REGISTRATION RESPONSE.
  async createUserWithDetails(
    data: Prisma.UserCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await client.user.create({
      data,
      select: this.FULL_USER_SELECT_SELF,
    });
  }

  //* email IS ONLY UNIQUE AMONG NON-DELETED ROWS (SEE User.email COMMENT IN
  //* SCHEMA) — MUST USE findFirst + deletedAt: null, NOT findUnique, OR AN
  //* ARCHIVED ROW SHARING THE EMAIL COULD BE MATCHED NON-DETERMINISTICALLY.
  //*
  //* EVERY LOOKUP BELOW LOWERCASES ITS email ARGUMENT BEFORE QUERYING — THE
  //* DEFENSIVE, SINGLE CHOKE POINT BEHIND CreateUserDto/LoginDto's OWN
  //* @Transform NORMALIZATION, SO A CALLER THAT BYPASSES THOSE DTOS (E.G. AN
  //* INTERNAL SERVICE CALL) CAN'T ACCIDENTALLY MISS A DIFFERENTLY-CASED ROW.
  async findUserByEmailWithDetails(
    email: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await client.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
      select: this.FULL_USER_SELECT_SELF,
    });
  }

  async findUserByEmail(email: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
      select: this.USER_SELECT,
    });
  }

  async findUserByEmailWithPassword(
    email: string,
    includePassword = false,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
      select: {
        ...this.USER_SELECT,
        password: includePassword, // * Needed for bcrypt compare
      },
    });
  }

  async findUserByIdWithPassword(
    id: number,
    includePassword = false,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.user.findUnique({
      where: { id },
      select: {
        ...this.USER_SELECT,
        password: includePassword,
      },
    });
  }

  //* DELIBERATELY THE NARROWEST SELECT IN THIS FILE — JwtStrategy RUNS IT ON
  //* EVERY AUTHENTICATED REQUEST TO CONFIRM THE ACCOUNT BEHIND THE TOKEN IS
  //* STILL ALLOWED IN, SO IT MUST STAY A SINGLE INDEXED PK READ WITH NO JOINS.
  //* RETURNS deletedAt SO A HARD-SOFT-DELETED ROW IS REJECTED TOO.
  async findAuthStateById(userId: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });
  }

  async findUserById(userId: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.user.findUnique({
      where: { id: userId },
      select: this.FULL_USER_SELECT_SELF,
    });
  }

  async updateUserStatusById(
    userId: number,
    status: UserStatus,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;

    return await client.user.update({
      where: { id: userId },
      data: { status },
      select: this.USER_SELECT,
    });
  }

  async updateUserPhone(
    userId: number,
    phone: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;

    return await client.user.update({
      where: { id: userId },
      data: { phone },
      select: this.USER_SELECT,
    });
  }

  async updateUserRole(
    userId: number,
    role: UserRole,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;

    return await client.user.update({
      where: { id: userId },
      data: { role },
      select: this.FULL_USER_SELECT_ADMIN,
    });
  }

  async updatePassword(
    id: number,
    hashedPassword: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;

    return await client.user.update({
      where: { id },
      data: { password: hashedPassword },
      select: this.FULL_USER_SELECT_SELF,
    });
  }

  async updateLastLoginTime(id: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return client.user.update({
      where: { id },
      data: {
        lastLoginAt: new Date(),
      },
    });
  }

  async findAllUsers(
    params: PaginationQueryDto,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await this.paginationService.paginate<
      Prisma.UserGetPayload<{ select: typeof this.FULL_USER_SELECT_ADMIN }>,
      typeof client.user
    >(client.user, params, {
      select: this.FULL_USER_SELECT_ADMIN,
      searchableFields: ['email', 'profile.firstName', 'profile.lastName'],
      defaultSortField: 'createdAt',
    });
  }

  /**
   * Every account headline the admin dashboard shows, in one round trip.
   *
   * Soft-deleted accounts (`deletedAt` set) are excluded from **every**
   * number except `deleted` itself. Note this is not the same thing as
   * `UserStatus.DEACTIVATED`: `UserService.deactivateUser` writes the status
   * without stamping `deletedAt`, so a deactivated account is still a live
   * row and is still counted in `byRole` / `byStatus` — which is what an
   * admin looking at "how many admins do we have" needs to see.
   *
   * The tallies come back as raw, **sparse** groupBy results — densifying
   * them is the service's job (`tallyByEnum`).
   */
  async countUserStats(newSince: Date, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    const live: Prisma.UserWhereInput = { deletedAt: null };

    const [total, deleted, roleTally, statusTally, verifiedEmails, newUsers] =
      await Promise.all([
        client.user.count({ where: live }),
        client.user.count({ where: { deletedAt: { not: null } } }),
        client.user.groupBy({
          by: ['role'],
          where: live,
          _count: { _all: true },
        }),
        client.user.groupBy({
          by: ['status'],
          where: live,
          _count: { _all: true },
        }),
        client.user.count({
          where: { ...live, security: { isEmailVerified: true } },
        }),
        client.user.count({ where: { ...live, createdAt: { gte: newSince } } }),
      ]);

    return {
      total,
      deleted,
      roleTally,
      statusTally,
      verifiedEmails,
      newUsers,
    };
  }
}

// async findByEmailWithAuth(email: string, includeAuth = false) {
//   return this.prisma.user.findUnique({
//     where: { email },
//     select: {
//       ...this.USER_SELECT,
//       password: includeAuth, // * Needed for bcrypt compare
//       security: includeAuth
//         ? {
//             select: {
//               loginAttempts: includeAuth,
//               isEmailVerified: includeAuth,
//             },
//           }
//         : false,
//     },
//   });
// }
