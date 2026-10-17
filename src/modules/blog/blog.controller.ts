import { BlogService } from './blog.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import {
  BlogResponseDto,
  BlogResponsePublicDto,
} from './dto/blog-response.dto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/auth/roles.decorator';
import { UserRole } from '../../generated/prisma/enums';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  PaginationQueryDto,
  ApiPaginatedResponse,
} from '../../shared/pagination';
import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Param,
  Patch,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response/response-message.decorator';

@ApiTags('Blog')
@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post('create-blog')
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiOperation({
    summary: 'Create a new blog post',
    description: 'Creates a blog post authored by the authenticated user.',
  })
  @ApiBody({ type: CreateBlogDto })
  @ApiCreatedResponse({
    description: 'Blog post created successfully.',
    type: BlogResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input data.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  @ApiForbiddenResponse({ description: 'Admin or Marketing role required.' })
  @ApiConflictResponse({
    description: 'A blog post with this title already exists.',
  })
  @ResponseMessage('Blog post created successfully')
  async createBlog(
    @Body() createBlogDto: CreateBlogDto,
    @UploadedFiles() files: { image?: Express.Multer.File[] },
    @Req() req: Request & { user?: { id: number } },
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException('User identity missing from request');
    }

    return this.blogService.createBlog(
      req.user.id,
      createBlogDto,
      files?.image?.[0],
    );
  }

  @Get('all-blogs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all blog posts (paginated)',
    description: 'Returns all blog posts with pagination support.',
  })
  @ApiPaginatedResponse(BlogResponseDto, 'Blog posts retrieved successfully.')
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  @ApiForbiddenResponse({ description: 'Admin or Marketing role required.' })
  @ResponseMessage('Blog posts retrieved successfully')
  async getAllBlogs(@Query() paginationParams: PaginationQueryDto) {
    return this.blogService.getAllBlogs(paginationParams);
  }

  @Get('published-blogs')
  @ApiOperation({
    summary: 'Get all published blog posts (paginated) (Public)',
    description:
      'Returns PUBLISHED blog posts with pagination support, most recently published first.',
  })
  @ApiPaginatedResponse(
    BlogResponsePublicDto,
    'Published blog posts retrieved successfully.',
  )
  @ResponseMessage('Published blog posts retrieved successfully')
  async getAllPublishedBlogs(@Query() paginationParams: PaginationQueryDto) {
    return await this.blogService.getAllPublishedBlogs(paginationParams);
  }

  @Get('blog-by-slug/:slug')
  @ApiOperation({
    summary: 'Get blog post by slug (Public)',
    description: 'Looks up a single blog post by its URL-friendly slug.',
  })
  @ApiOkResponse({
    description: 'Blog post retrieved successfully.',
    type: BlogResponsePublicDto,
  })
  @ApiNotFoundResponse({ description: 'Blog post not found.' })
  @ResponseMessage('Blog post retrieved successfully')
  async getBlogBySlug(@Param('slug') slug: string) {
    return this.blogService.getBlogBySlug(slug);
  }

  @Patch('update-blog/:id')
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @UseInterceptors(FileFieldsInterceptor([{ name: 'image', maxCount: 1 }]))
  @ApiOperation({
    summary: 'Update a blog post',
    description: 'Partially updates an existing blog post.',
  })
  @ApiBody({ type: UpdateBlogDto })
  @ApiOkResponse({
    description: 'Blog post updated successfully.',
    type: BlogResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input data.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  @ApiForbiddenResponse({ description: 'Admin or Marketing role required.' })
  @ApiNotFoundResponse({ description: 'Blog post not found.' })
  @ApiConflictResponse({
    description: 'New title results in a duplicate slug.',
  })
  @ResponseMessage('Blog post updated successfully')
  async updateBlog(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBlogDto: UpdateBlogDto,
    @UploadedFiles() files: { image?: Express.Multer.File[] },
  ) {
    return this.blogService.updateBlog(id, updateBlogDto, files?.image?.[0]);
  }

  @Delete('delete-blog/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a blog post',
    description: 'Permanently deletes a blog post. Admin only.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  @ApiNotFoundResponse({ description: 'Blog post not found.' })
  @ResponseMessage('Blog post deleted successfully')
  async deleteBlog(@Param('id', ParseIntPipe) id: number) {
    return this.blogService.deleteBlog(id);
  }
}
