import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../../prisma/base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

@Injectable()
export class ProfileRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async createUserProfile(
    data: Prisma.ProfileUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.profile.create({ data });
  }

  async updateProfile(
    userId: number,
    data: Prisma.ProfileUpdateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return client.profile.update({ where: { userId }, data });
  }
}
