import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BaseRepository } from '../../prisma/base.repository';
import { Prisma, BlogStatus } from '../../generated/prisma/client';
import { PaginationService, PaginationQueryDto } from '../../shared/pagination';
import {
  BLOG_SELECT_ADMIN,
  BLOG_SELECT_PUBLIC,
  BLOG_SELECT_SLUG_CONFLICT,
} from './blog.select';

@Injectable()
export class BlogRepository extends BaseRepository {
  constructor(
    prisma: PrismaService,
    private readonly paginationService: PaginationService,
  ) {
    super(prisma);
  }

  // ─── Reads — Single Lookups (role-based) ────────────────────────────────────

  async findByIdAdmin(id: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.blog.findUnique({
      where: { id },
      select: BLOG_SELECT_ADMIN,
    });
  }

  async findBySlugPublic(slug: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.blog.findUnique({
      where: { slug },
      select: BLOG_SELECT_PUBLIC,
    });
  }

  /** Cheap existence/uniqueness check used by the create/update slug guard. */
  async findSlugConflict(slug: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.blog.findUnique({
      where: { slug },
      select: BLOG_SELECT_SLUG_CONFLICT,
    });
  }

  // ─── Reads — Lists ───────────────────────────────────────────────────────────

  async findAllBlogsAdmin(
    params: PaginationQueryDto,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await this.paginationService.paginate<
      Prisma.BlogGetPayload<{ select: typeof BLOG_SELECT_ADMIN }>,
      typeof client.blog
    >(client.blog, params, {
      select: BLOG_SELECT_ADMIN,
      searchableFields: ['title', 'slug'],
      defaultSortField: 'createdAt',
    });
  }

  async findAllPublishedBlogs(
    params: PaginationQueryDto,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await this.paginationService.paginate<
      Prisma.BlogGetPayload<{ select: typeof BLOG_SELECT_PUBLIC }>,
      typeof client.blog
    >(client.blog, params, {
      where: { status: BlogStatus.PUBLISHED },
      select: BLOG_SELECT_PUBLIC,
      searchableFields: ['title', 'slug'],
      defaultSortField: 'publishedAt',
    });
  }

  // ─── Reads — Dashboard aggregates ────────────────────────────────────────────

  /**
   * Every blog headline the admin dashboard shows, in one round trip.
   * `Blog` has no soft delete, so there is nothing to exclude here.
   *
   * `statusTally` is the raw, **sparse** groupBy result — densifying it is
   * the service's job (`tallyByEnum`).
   */
  async countBlogStats(tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;

    const [total, statusTally, comments] = await Promise.all([
      client.blog.count(),
      client.blog.groupBy({ by: ['status'], _count: { _all: true } }),
      client.blog.aggregate({ _sum: { totalComments: true } }),
    ]);

    return { total, statusTally, totalComments: comments._sum.totalComments ?? 0 };
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────

  async createBlog(
    data: Prisma.BlogUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await client.blog.create({
      data,
      select: BLOG_SELECT_ADMIN,
    });
  }

  async updateBlog(
    id: number,
    data: Prisma.BlogUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return await client.blog.update({
      where: { id },
      data,
      select: BLOG_SELECT_ADMIN,
    });
  }

  async deleteBlog(id: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    return await client.blog.delete({ where: { id }, select: { id: true } });
  }
}
