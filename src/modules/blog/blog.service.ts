import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlogRepository } from './blog.repository';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import {
  BlogResponseDto,
  BlogResponsePublicDto,
} from './dto/blog-response.dto';
import { BlogStatsDto } from './dto/blog-stats.dto';
import { tallyByEnum } from '../../common/utils/tally.util';
import { generateSlug } from '../../common/utils/slug.util';
import { STORAGE_SERVICE_TOKEN } from '../../shared/storage/storage.constants';
import type { IStorageService } from '../../shared/storage/interfaces/storage.interface';
import { PaginationQueryDto, IPaginatedResult } from '../../shared/pagination';
import { BlogStatus } from '../../generated/prisma/enums';

const BLOG_IMAGE_FOLDER = 'blogs/images';

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(
    private readonly blogRepository: BlogRepository,
    @Inject(STORAGE_SERVICE_TOKEN)
    private readonly storageService: IStorageService,
    private readonly configService: ConfigService,
  ) {}

  async createBlog(
    authorId: number,
    createBlogDto: CreateBlogDto,
    image?: Express.Multer.File,
  ): Promise<BlogResponseDto> {
    const { title, content, status, blogCategory, metaTitle, metaDescription } =
      createBlogDto;
    const slug = generateSlug(title);
    const existingBlog = await this.blogRepository.findSlugConflict(slug);
    if (existingBlog) {
      throw new ConflictException('A blog post with this title already exists');
    }

    let imagePath: string | undefined;
    if (image) {
      imagePath = await this.uploadFile(image, BLOG_IMAGE_FOLDER);
    }

    try {
      const newBlog = await this.blogRepository.createBlog({
        title,
        content,
        status,
        blogCategory,
        metaTitle,
        metaDescription,
        slug,
        authorId,
        ...(imagePath && { imageUrl: imagePath }),
        publishedAt: status === BlogStatus.PUBLISHED ? new Date() : null,
      });

      return new BlogResponseDto(
        newBlog,
        this.configService.get<string>('app.baseUrl'),
      );
    } catch (error) {
      if (imagePath) {
        await this.deleteFile(imagePath, BLOG_IMAGE_FOLDER);
      }
      throw error;
    }
  }

  async getAllBlogs(
    params: PaginationQueryDto,
  ): Promise<IPaginatedResult<BlogResponseDto>> {
    const paginatedBlogs = await this.blogRepository.findAllBlogsAdmin(params);

    return {
      ...paginatedBlogs,
      data: paginatedBlogs.data.map(
        (blog) =>
          new BlogResponseDto(
            blog,
            this.configService.get<string>('app.baseUrl'),
          ),
      ),
    };
  }

  async getAllPublishedBlogs(
    params: PaginationQueryDto,
  ): Promise<IPaginatedResult<BlogResponsePublicDto>> {
    const paginatedBlogs =
      await this.blogRepository.findAllPublishedBlogs(params);

    return {
      ...paginatedBlogs,
      data: paginatedBlogs.data.map(
        (blog) =>
          new BlogResponsePublicDto(
            blog,
            this.configService.get<string>('app.baseUrl'),
          ),
      ),
    };
  }

  /**
   * The Blog module's slice of the admin dashboard overview.
   * `DashboardService` calls this rather than querying `Blog` itself.
   */
  async getBlogStats(): Promise<BlogStatsDto> {
    const stats = await this.blogRepository.countBlogStats();

    return new BlogStatsDto({
      total: stats.total,
      byStatus: tallyByEnum(
        Object.values(BlogStatus),
        stats.statusTally,
        (row) => row.status,
        (row) => row._count._all,
      ),
      totalComments: stats.totalComments,
    });
  }

  async getBlogBySlug(slug: string): Promise<BlogResponsePublicDto> {
    const blog = await this.blogRepository.findBySlugPublic(slug);
    if (!blog) {
      throw new NotFoundException('Blog post not found');
    }
    return new BlogResponsePublicDto(
      blog,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  async updateBlog(
    id: number,
    updateBlogDto: UpdateBlogDto,
    image?: Express.Multer.File,
  ): Promise<BlogResponseDto> {
    const blog = await this.blogRepository.findByIdAdmin(id);
    if (!blog) {
      throw new NotFoundException(`Blog post with ID ${id} not found`);
    }

    const { title, content, status, blogCategory, metaTitle, metaDescription } =
      updateBlogDto;
    const updateData: {
      title?: string;
      content?: string;
      status?: UpdateBlogDto['status'];
      blogCategory?: string;
      metaTitle?: string;
      metaDescription?: string;
      slug?: string;
      imageUrl?: string;
      publishedAt?: Date | null;
    } = { title, content, status, blogCategory, metaTitle, metaDescription };

    if (updateBlogDto.title && updateBlogDto.title !== blog.title) {
      const newSlug = generateSlug(updateBlogDto.title);
      const existingSlug = await this.blogRepository.findSlugConflict(newSlug);
      if (existingSlug && existingSlug.id !== id) {
        throw new ConflictException('New title results in a duplicate slug');
      }
      updateData.slug = newSlug;
    }

    //* STAMP/CLEAR publishedAt ONLY ON AN ACTUAL STATUS TRANSITION — RE-SAVING
    //* AN ALREADY-PUBLISHED POST MUST NOT RESET ITS ORIGINAL PUBLISH TIME
    if (status === BlogStatus.PUBLISHED && blog.status !== BlogStatus.PUBLISHED) {
      updateData.publishedAt = new Date();
    } else if (status && status !== BlogStatus.PUBLISHED) {
      updateData.publishedAt = null;
    }

    if (image) {
      updateData.imageUrl = await this.uploadFile(image, BLOG_IMAGE_FOLDER);
      if (blog.imageUrl) {
        await this.deleteFile(blog.imageUrl, BLOG_IMAGE_FOLDER);
      }
    }

    const updatedBlog = await this.blogRepository.updateBlog(id, updateData);
    return new BlogResponseDto(
      updatedBlog,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  async deleteBlog(id: number): Promise<void> {
    const blog = await this.blogRepository.findByIdAdmin(id);
    if (!blog) {
      throw new NotFoundException(`Blog post with ID ${id} not found`);
    }
    await this.blogRepository.deleteBlog(id);
    if (blog.imageUrl) {
      await this.deleteFile(blog.imageUrl, BLOG_IMAGE_FOLDER);
    }
  }

  private async uploadFile(
    file: Express.Multer.File,
    folder: string,
  ): Promise<string> {
    const savedFile = await this.storageService.saveFile(file, folder);
    return savedFile.path;
  }

  private async deleteFile(path: string, folder: string): Promise<void> {
    const filename = path.split('/').pop();
    if (!filename) {
      return;
    }
    await this.storageService
      .deleteFile(filename, folder)
      .catch((e) => this.logger.warn(`Could not delete blog image: ${e}`));
  }
}
