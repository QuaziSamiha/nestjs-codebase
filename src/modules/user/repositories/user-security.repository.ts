import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BaseRepository } from '../../../prisma/base.repository';
import { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class UserSecurityRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  private readonly SECURITY_SELECT_GENERAL_USER = {
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

  async createUserSecurity(
    data: Prisma.UserSecurityUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.userSecurity.create({
      data,
      select: this.SECURITY_SELECT_GENERAL_USER,
    });
  }

  //* ADMIN-ONLY PATH (SEE UserService.updateUserSecurity). UPSERT RATHER THAN
  //* UPDATE: EVERY USER THIS APP CREATES GETS A UserSecurity ROW ALONGSIDE IT,
  //* BUT AN UPSERT KEEPS AN ADMIN FROM HITTING A P2025 ON ANY IMPORTED/LEGACY
  //* ROW THAT PREDATES THAT INVARIANT. RETURNS THE ADMIN TIER BECAUSE ONLY
  //* ADMINS CAN REACH IT.
  async updateAssignedIp(
    userId: number,
    assignedIp: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.userSecurity.upsert({
      where: { userId },
      update: { assignedIp },
      create: { userId, assignedIp },
      select: this.SECURITY_SELECT_ADMIN,
    });
  }

  async updateEmailVerification(
    userId: number,
    isVerified: boolean,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.userSecurity.update({
      where: { userId },
      data: {
        isEmailVerified: isVerified,
        emailVerifiedAt: isVerified ? new Date() : null,
      },
      select: this.SECURITY_SELECT_GENERAL_USER,
    });
  }

  // * Updates tracking data on successful login.
  async updateLoginMetadata(
    userId: number,
    ip?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.userSecurity.update({
      where: { userId },
      data: {
        lastLoginIp: ip ? ip : undefined,
        loginAttempts: 0, // * Reset attempts on success
      },
    });
  }

  //* Increments failed login attempts for security throttling.
  async incrementLoginAttempts(userId: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return client.userSecurity.update({
      where: { userId },
      data: {
        loginAttempts: { increment: 1 },
      },
    });
  }
}
