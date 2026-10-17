import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export abstract class BaseRepository {
  constructor(protected readonly prisma: PrismaService) {}

  /**
   * Global transaction wrapper
   */
  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const result = await this.prisma.$transaction((tx) =>
      fn(tx as Prisma.TransactionClient),
    );
    return result as T;
  }
}
