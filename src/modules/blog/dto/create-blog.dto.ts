import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { BlogStatus } from '../../../generated/prisma/enums';

export class CreateBlogDto {
  // ─── Identity ────────────────────────────────────────────────────────────────

  @ApiProperty({
    description:
      'Title of the blog post. Must be unique — the URL slug is derived from this automatically.',
    example: '5 Tips for Better Sleep',
    minLength: 3,
    maxLength: 255,
  })
  @IsNotEmpty({ message: 'Title is required' })
  @IsString({ message: 'Title must be a valid text string' })
  @MinLength(3, { message: 'Title must be at least 3 characters long' })
  @MaxLength(255, { message: 'Title cannot exceed 255 characters' })
  title!: string;

  // ─── Content ─────────────────────────────────────────────────────────────────

  @ApiProperty({
    description: 'Full article body (HTML/Markdown).',
    example: '<p>Getting quality sleep starts with...</p>',
    minLength: 20,
  })
  @IsNotEmpty({ message: 'Content is required' })
  @IsString({ message: 'Content must be a valid text string' })
  @MinLength(20, { message: 'Content must be at least 20 characters long' })
  content!: string;

  // ─── Configuration ───────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    description:
      'Lifecycle/visibility status of the blog post. DRAFT is never publicly visible; PUBLISHED is live once `publishedAt` has passed. Defaults to DRAFT.',
    enum: BlogStatus,
    enumName: 'BlogStatus',
    default: BlogStatus.DRAFT,
    example: BlogStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(BlogStatus, { message: 'Please select a valid status' })
  status?: BlogStatus;

  // ─── Categorization ──────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    description:
      'Free-text category label used to group related posts, e.g. "Guides", "Announcements".',
    example: 'Guides',
    maxLength: 100,
  })
  @IsOptional()
  @IsString({ message: 'Blog category must be a valid text string' })
  @MaxLength(100, { message: 'Blog category cannot exceed 100 characters' })
  blogCategory?: string;

  // ─── Media ───────────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description:
      'Cover/hero image file for the blog post, shown on the detail page and listing cards (stored at `imageUrl`).',
  })
  @IsOptional()
  image?: Express.Multer.File;

  // ─── SEO Metadata ────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    description:
      'SEO <title> tag override. Falls back to `title` if omitted. Search engines typically truncate past ~60 characters.',
    example: '5 Tips for Better Sleep | My Blog',
    maxLength: 255,
  })
  @IsOptional()
  @IsString({ message: 'Meta title must be a valid text string' })
  @MaxLength(255, { message: 'Meta title cannot exceed 255 characters' })
  metaTitle?: string;

  @ApiPropertyOptional({
    description:
      'SEO <meta description> tag. Search engines typically truncate past ~160 characters.',
    example: 'Simple, evidence-based habits for deeper sleep.',
  })
  @IsOptional()
  @IsString({ message: 'Meta description must be a valid text string' })
  metaDescription?: string;
}
