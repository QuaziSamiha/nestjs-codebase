import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { BlogStatus } from '../../../generated/prisma/enums';

/** The Blog module's contribution to the admin dashboard overview. */
export class BlogStatsDto {
  @Expose()
  @ApiProperty({ description: 'Every blog post, any status', example: 68 })
  total!: number;

  @Expose()
  @ApiProperty({
    description: 'Count per `BlogStatus`, zero-filled across the whole enum.',
    example: { PUBLISHED: 51, DRAFT: 14, ARCHIVED: 3 },
    additionalProperties: { type: 'number' },
  })
  byStatus!: Record<BlogStatus, number>;

  @Expose()
  @ApiProperty({ description: 'Posts publicly visible', example: 51 })
  published!: number;

  @Expose()
  @ApiProperty({ description: 'Posts still being written', example: 14 })
  draft!: number;

  @Expose()
  @ApiProperty({
    description: 'Comments across every post — the sum of `totalComments`.',
    example: 312,
  })
  totalComments!: number;

  constructor(init: {
    total: number;
    byStatus: Record<BlogStatus, number>;
    totalComments: number;
  }) {
    this.total = init.total;
    this.byStatus = init.byStatus;
    this.published = init.byStatus[BlogStatus.PUBLISHED];
    this.draft = init.byStatus[BlogStatus.DRAFT];
    this.totalComments = init.totalComments;
  }
}
