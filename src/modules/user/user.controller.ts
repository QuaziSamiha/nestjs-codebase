import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  NotFoundException,
  ForbiddenException,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Patch,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserSecurityDto } from './dto/update-user-security.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/auth/roles.decorator';
import { UserRole } from '../../generated/prisma/enums';
import {
  PaginationQueryDto,
  ApiPaginatedResponse,
} from '../../shared/pagination';
import { UserResponseDtoWithDetails } from './dto/user-response.dto';
import { UserStatsDto } from './dto/user-stats.dto';
import { ResponseMessage } from '../../common/decorators/response/response-message.decorator';
import {
  FORGOT_PASSWORD_THROTTLE,
  RESET_PASSWORD_THROTTLE,
  SIGNUP_THROTTLE,
  THROTTLER_SHORT,
} from '../../common/throttler/throttler.constants';

@ApiTags('Users')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  //* TIGHTLY THROTTLED: THIS IS PUBLIC, UNAUTHENTICATED, AND EVERY ACCEPTED CALL COSTS A
  //* REAL OUTBOUND EMAIL (THE SIGNUP OTP) PLUS A BCRYPT HASH. LEFT OPEN IT IS BOTH A MAIL
  //* -COST/SENDER-REPUTATION SINK AND A CHEAP WAY TO BURN CPU. 3 PER HOUR PER IP — SEE
  //* SIGNUP_THROTTLE AND docs/concepts/rate-limiting.md §3.
  @Throttle({ [THROTTLER_SHORT]: SIGNUP_THROTTLE })
  @Post('create-user')
  @ApiConsumes('application/json')
  @ApiOperation({
    summary:
      'Create a new user / User Registration / Sign Up by email password',
  })
  @ApiCreatedResponse({
    description: 'User created successfully',
  })
  @ApiBadRequestResponse({ description: 'Invalid input data' })
  @ApiResponse({
    status: 429,
    description: 'Too many signup attempts from this IP. Limit is 3 per hour.',
  })
  @ApiBody({ type: CreateUserDto })
  @ResponseMessage('User created successfully')
  async register(@Body() createUserDto: CreateUserDto, @Ip() ip: string) {
    return this.userService.registerUser(createUserDto, ip);
  }

  @Throttle({ [THROTTLER_SHORT]: FORGOT_PASSWORD_THROTTLE })
  @Post('forgot-password')
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Request a password reset code',
    description:
      'Emails a 6-digit PASSWORD_RESET code to the address if it belongs to an active email/password account. Always returns 200 with the same message regardless of whether the account exists, so the route cannot be used to discover registered addresses.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: 'Request accepted.' })
  @ApiBadRequestResponse({ description: 'Invalid email address.' })
  @ApiResponse({
    status: 429,
    description:
      'Too many password reset requests from this IP. Limit is 3 per hour.',
  })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(
    'If an account exists for that email, a reset code has been sent.',
  )
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.userService.requestPasswordReset(forgotPasswordDto);
  }

  //* STEP 2. THE CODE IS THE ONLY CREDENTIAL, SO THIS IS AN OTP-GUESSING SURFACE FIRST —
  //* HENCE THE OTP-VERIFY-SHAPED BUDGET (5 PER 5 MINUTES, THEN A 15-MINUTE BLOCK) RATHER
  //* THAN THE MAIL-COST-SHAPED ONE ABOVE.
  @Throttle({ [THROTTLER_SHORT]: RESET_PASSWORD_THROTTLE })
  @Post('reset-password')
  @ApiConsumes('application/json')
  @ApiOperation({
    summary: 'Set a new password using a reset code',
    description:
      'Verifies the emailed PASSWORD_RESET code and writes the new password in one transaction. The code is single-use and expires 10 minutes after it was issued. No session is returned — the user signs in with the new password.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset successfully.' })
  @ApiBadRequestResponse({
    description:
      'Invalid input, an invalid/expired code, an ineligible account, or a new password identical to the current one.',
  })
  @ApiResponse({
    status: 429,
    description:
      'Too many reset attempts from this IP. Limit is 5 per 5 minutes, then a 15-minute block.',
  })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset successfully')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.userService.resetPassword(resetPasswordDto);
  }

  @Get('all-user')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all users (Admin only)' })
  @ApiPaginatedResponse(
    UserResponseDtoWithDetails,
    'Users retrieved successfully.',
  )
  @ApiResponse({ status: 403, description: 'Forbidden. Admin role required.' })
  @ResponseMessage('Users retrieved successfully')
  async getAllUsers(@Query() paginationParams: PaginationQueryDto) {
    return this.userService.getAllUsers(paginationParams);
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user statistics (Admin only)' })
  @ApiResponse({ status: 200, type: UserStatsDto })
  @ApiResponse({ status: 403, description: 'Forbidden. Admin role required.' })
  @ResponseMessage('User statistics retrieved successfully')
  async getUserStats() {
    return this.userService.getUserStats();
  }

  @Get('my-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get logged in user profile' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ResponseMessage('Profile retrieved successfully')
  async getMyProfile(@Req() req: Request & { user?: { id: number } }) {
    if (!req.user?.id) {
      throw new NotFoundException('User identity missing from request');
    }
    return this.userService.getMyProfile(req.user.id);
  }

  @Patch('update-profile/:id')
  @ApiConsumes('multipart/form-data')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('avatar'))
  @ApiOperation({
    summary: 'Update profile (first name, last name, phone, avatar)',
    description:
      "Partially updates the caller's own profile. Uploading a new avatar replaces the old one. Admins may also update any user's profile.",
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden. You can only update your own profile.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ResponseMessage('Profile updated successfully')
  async updateProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProfileDto: UpdateProfileDto,
    @UploadedFile() avatar: Express.Multer.File | undefined,
    @Req() req: Request & { user?: { id: number; role?: string } },
  ) {
    if (!req.user?.id) {
      throw new NotFoundException('User identity missing from request');
    }

    if (req.user.id !== id && req.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only update your own profile');
    }

    return this.userService.updateProfile(id, updateProfileDto, avatar);
  }

  @Patch('update-user-role/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user role (Admin only)' })
  @ApiResponse({ status: 200, description: 'User role updated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Admin role required.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ResponseMessage('User role updated successfully')
  async updateUserRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
  ) {
    return this.userService.updateUserRole(id, updateUserRoleDto.role);
  }

  //* THE ONLY WRITE PATH FOR assignedIp. IT IS AN IP-ALLOWLIST VALUE FOR
  //* INTERNAL RESTRICTED ACCESS, SO IT IS ADMIN-SET ONLY AND IS NOT
  //* PART OF THE PUBLIC create-user PAYLOAD — SEE UpdateUserSecurityDto.
  @Patch('update-user-security/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Update a user's assigned IP (Admin only)",
    description:
      'Sets or clears the static IP allowlist value used for internal restricted access. Send `assignedIp: null` to clear it. Admin-set only — this field is deliberately not accepted during self-registration.',
  })
  @ApiBody({ type: UpdateUserSecurityDto })
  @ApiResponse({
    status: 200,
    description: 'User security updated successfully.',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Admin role required.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ResponseMessage('User security updated successfully')
  updateUserSecurity(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserSecurityDto: UpdateUserSecurityDto,
  ) {
    return this.userService.updateUserSecurity(id, updateUserSecurityDto);
  }

  @Delete('deactivate-user/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Deactivate a user (Admin only)',
    description:
      'Soft-deletes a user by setting status to DEACTIVATED. Reversible -- the row and everything that references it stay intact.',
  })
  @ApiResponse({ status: 200, description: 'User deactivated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden. Admin role required.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 409, description: 'User is already deactivated.' })
  @ResponseMessage('User deactivated successfully')
  async deactivateUser(@Param('id', ParseIntPipe) id: number) {
    return this.userService.deactivateUser(id);
  }

  @Patch('update-password/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user password' })
  @ApiResponse({ status: 200, description: 'Password updated successfully.' })
  @ApiResponse({
    status: 400,
    description:
      'Current password does not match, or new password is the same as the current password.',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden. You can only update your own password.',
  })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ResponseMessage('Password updated successfully')
  async updatePassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePasswordDto: UpdatePasswordDto,
    @Req() req: Request & { user?: { id: number; role?: string } },
  ) {
    if (!req.user?.id) {
      throw new NotFoundException('User identity missing from request');
    }

    if (req.user.id !== id && req.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only update your own password');
    }

    return this.userService.updatePassword(id, updatePasswordDto);
  }
}
