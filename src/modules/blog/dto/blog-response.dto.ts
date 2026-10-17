import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { BlogStatus } from '../../../generated/prisma/browser';
import { BlogModel } from '../../../generated/prisma/models';
import { UserMinifiedResponseDto } from '../../user/dto/user-response.dto';
import type { MinifiedUser } from '../../user/dto/user-response.dto';
import { formatDisplayName } from '../../../common/utils/display-name.util';

export class BlogResponseDto {
  @Expose()
  @ApiProperty({ description: 'Internal auto-increment ID', example: 1 })
  id!: number;

  @Expose()
  @ApiProperty({
    description: 'Public-facing UUID, safe to expose in URLs and API responses',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sid!: string;

  @Expose()
  @ApiProperty({
    enum: BlogStatus,
    description: 'Lifecycle/visibility status of the blog post',
    example: BlogStatus.PUBLISHED,
  })
  status!: BlogStatus;

  @Expose()
  @ApiProperty({
    description: 'Title of the blog post',
    example: '5 Tips for Better Sleep',
  })
  title!: string;

  @Expose()
  @ApiProperty({
    description: 'URL-friendly slug auto-generated from the title',
    example: '5-tips-for-better-sleep',
  })
  slug!: string;

  @Expose()
  @ApiProperty({
    description: 'Full article body (HTML/Markdown)',
    example: '<p>Getting quality sleep starts with...</p>',
  })
  content!: string;

  @Expose()
  @ApiPropertyOptional({
    description: 'Free-text category label',
    example: 'Guides',
  })
  blogCategory?: string;

  @Expose()
  @ApiPropertyOptional({
    description: 'Cover/hero image URL',
    example: 'https://cdn.example.com/blogs/sleep-tips.jpg',
  })
  imageUrl?: string;

  @Expose()
  @ApiProperty({
    description: 'Denormalized comment counter',
    example: 12,
  })
  totalComments!: number;

  @Expose()
  @ApiPropertyOptional({ description: 'SEO meta title' })
  metaTitle?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'SEO meta description' })
  metaDescription?: string;

  @Expose()
  @ApiProperty({ description: 'ISO timestamp when the record was created' })
  createdAt!: Date;

  @Expose()
  @ApiProperty({ description: 'ISO timestamp of the last update' })
  updatedAt!: Date;

  @Expose()
  @ApiPropertyOptional({
    description: 'Scheduled/actual publish timestamp',
  })
  publishedAt?: Date | null;

  @Expose()
  @ApiPropertyOptional({
    type: () => UserMinifiedResponseDto,
    description: 'Author of the blog post',
  })
  @Type(() => UserMinifiedResponseDto)
  author?: UserMinifiedResponseDto | null;

  constructor(
    blog: Partial<BlogModel> & {
      author?: MinifiedUser | null;
    },
    baseUrl?: string,
  ) {
    this.id = blog.id!;
    this.sid = blog.sid!;
    this.status = blog.status!;
    this.title = blog.title!;
    this.slug = blog.slug!;
    this.content = blog.content!;
    this.blogCategory = blog.blogCategory ?? undefined;
    this.imageUrl = blog.imageUrl
      ? blog.imageUrl.startsWith('http')
        ? blog.imageUrl
        : `${baseUrl}${blog.imageUrl}`
      : undefined;
    this.totalComments = blog.totalComments!;
    this.metaTitle = blog.metaTitle ?? undefined;
    this.metaDescription = blog.metaDescription ?? undefined;
    this.createdAt = blog.createdAt!;
    this.updatedAt = blog.updatedAt!;
    this.publishedAt = blog.publishedAt ?? undefined;
    this.author =
      blog.author && typeof blog.author === 'object'
        ? new UserMinifiedResponseDto(blog.author)
        : null;
  }
}

//* ═══════════════════════════════════════════════════════════════════════
//* PUBLIC RESPONSE — public blog-detail view. Deliberately
//* excludes `status` (internal workflow state) and the raw `authorId`/full
//* `author` object (staff id + role) — a public reader only needs a byline
//* name, never the writing user's internal identity or role.
//* ═══════════════════════════════════════════════════════════════════════

export class BlogResponsePublicDto {
  @Expose()
  @ApiProperty({ description: 'Internal auto-increment ID', example: 1 })
  id!: number;

  @Expose()
  @ApiProperty({
    description: 'Public-facing UUID, safe to expose in URLs and API responses',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sid!: string;

  @Expose()
  @ApiProperty({
    description: 'Title of the blog post',
    example: '5 Tips for Better Sleep',
  })
  title!: string;

  @Expose()
  @ApiProperty({
    description: 'URL-friendly slug auto-generated from the title',
    example: '5-tips-for-better-sleep',
  })
  slug!: string;

  @Expose()
  @ApiProperty({
    description: 'Full article body (HTML/Markdown)',
    example: '<p>Getting quality sleep starts with...</p>',
  })
  content!: string;

  @Expose()
  @ApiPropertyOptional({
    description: 'Free-text category label',
    example: 'Guides',
  })
  blogCategory?: string;

  @Expose()
  @ApiPropertyOptional({
    description: 'Cover/hero image URL',
    example: 'https://cdn.example.com/blogs/sleep-tips.jpg',
  })
  imageUrl?: string;

  @Expose()
  @ApiProperty({
    description: 'Denormalized comment counter',
    example: 12,
  })
  totalComments!: number;

  @Expose()
  @ApiPropertyOptional({ description: 'SEO meta title' })
  metaTitle?: string;

  @Expose()
  @ApiPropertyOptional({ description: 'SEO meta description' })
  metaDescription?: string;

  @Expose()
  @ApiPropertyOptional({
    description: 'Scheduled/actual publish timestamp',
  })
  publishedAt?: Date | null;

  @Expose()
  @ApiPropertyOptional({
    description:
      'Display name for the byline. Omitted if no author is assigned.',
    example: 'Jane Doe',
  })
  authorName?: string;

  constructor(
    blog: Partial<BlogModel> & {
      author?: MinifiedUser | null;
    },
    baseUrl?: string,
  ) {
    this.id = blog.id!;
    this.sid = blog.sid!;
    this.title = blog.title!;
    this.slug = blog.slug!;
    this.content = blog.content!;
    this.blogCategory = blog.blogCategory ?? undefined;
    this.imageUrl = blog.imageUrl
      ? blog.imageUrl.startsWith('http')
        ? blog.imageUrl
        : `${baseUrl}${blog.imageUrl}`
      : undefined;
    this.totalComments = blog.totalComments!;
    this.metaTitle = blog.metaTitle ?? undefined;
    this.metaDescription = blog.metaDescription ?? undefined;
    this.publishedAt = blog.publishedAt ?? undefined;
    this.authorName = formatDisplayName(blog.author?.profile);
  }
}
