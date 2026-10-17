import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { OTPType } from '../../generated/prisma/enums';
import { BaseRepository } from '../../prisma/base.repository';

@Injectable()
export class OtpRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  //   private readonly OTP_SELECT = {
  //     id: true,
  //     code: true,
  //     type: true,
  //     expiresAt: true,
  //     isUsed: true,
  //     identifier: true,
  //     createdAt: true,
  //   } as const;

  async createOTP(
    data: Prisma.OTPUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await client.oTP.create({ data });
  }

  async findLatestValidOtp(identifier: string, type: OTPType) {
    return this.prisma.oTP.findFirst({
      where: {
        identifier,
        type,
        isUsed: false,
        expiresAt: { gt: new Date() }, // * Not expired
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsUsed(id: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.oTP.update({
      where: { id },
      data: { isUsed: true },
    });
  }

  /**
   * Deletes all OTPs that are either used OR expired.
   * Run this periodically (e.g., once a day) via a Cron job.
   */
  async cleanUpOldOtps() {
    return await this.prisma.oTP.deleteMany({
      where: {
        OR: [{ isUsed: true }, { expiresAt: { lt: new Date() } }],
      },
    });
  }
}
