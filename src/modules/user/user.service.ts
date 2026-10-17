import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRepository } from './repositories/user.repository';
import { ProfileRepository } from './repositories/profile.repository';
import { UserSecurityRepository } from './repositories/user-security.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { VerifiedSocialProfile } from '../auth/dto/third-partry-auth.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserSecurityDto } from './dto/update-user-security.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetResponseDto } from './dto/password-reset-response.dto';
import {
  UserResponseDto,
  UserResponseDtoWithDetails,
} from './dto/user-response.dto';
import { HashService } from '../../shared/hash/hash.service';
import { OtpService } from '../otp/otp.service';
import {
  OTPType,
  UserStatus,
  UserRole,
  AuthProvider,
} from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';
import {
  UserSecurityAdminResponseDto,
  UserSecurityMeResponseDto,
} from './dto/user-security-response.dto';
import { PaginationQueryDto, IPaginatedResult } from '../../shared/pagination';
import { STORAGE_SERVICE_TOKEN } from '../../shared/storage/storage.constants';
import { assertAccountCanAuthenticate } from '../../common/utils/account-status.util';
import { sumOf, tallyByEnum } from '../../common/utils/tally.util';
import {
  ADMIN_ROLES,
  END_USER_ROLES,
  UserStatsDto,
} from './dto/user-stats.dto';
import type { IStorageService } from '../../shared/storage/interfaces/storage.interface';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

//* TRAILING WINDOW FOR THE "NEW USERS" FIGURE IN getUserStats.
const DEFAULT_NEW_USER_WINDOW_DAYS = 30;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly securityRepo: UserSecurityRepository,
    @Inject(forwardRef(() => OtpService))
    private readonly otpService: OtpService,
    private readonly hashService: HashService,
    private readonly configService: ConfigService,
    @Inject(STORAGE_SERVICE_TOKEN)
    private readonly storageService: IStorageService,
  ) {}

  //* THIS ENDPOINT IS EMAIL/PASSWORD REGISTRATION ONLY. OAUTH ACCOUNTS ARE
  //* NEVER CREATED HERE — THEY ONLY EVER COME FROM AuthService.socialAuth,
  //* WHICH DERIVES authProvider/providerId FROM A SERVER-VERIFIED PROVIDER
  //* TOKEN. CreateUserDto HAS NO authProvider/providerId FIELDS FOR THIS
  //* REASON: A PUBLIC, UNAUTHENTICATED ENDPOINT MUST NEVER LET A CALLER
  //* SELF-ASSERT AN OAUTH IDENTITY THEY MAY NOT ACTUALLY OWN.
  async registerUser(
    dto: CreateUserDto,
    ipAddress: string,
  ): Promise<UserResponseDtoWithDetails> {
    const { profile, ...userData } = dto;

    // * RULE 1: Check if user exists
    const existing = await this.userRepo.findUserByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const hashedPassword = await this.hashService.hash(userData.password);

    //* RULE 2: EXECUTE TRANSACTION — DB WRITES ONLY. THE OTP EMAIL IS SENT
    //* AFTER COMMIT (SEE BELOW): HOLDING PRISMA'S INTERACTIVE TRANSACTION
    //* OPEN ACROSS AN SMTP ROUND-TRIP RISKS THE DEFAULT 5S TIMEOUT AND WOULD
    //* ROLL BACK AN OTHERWISE-VALID REGISTRATION OVER MAIL-PROVIDER LATENCY.
    const { fullUser, plainOtp } = await this.userRepo.withTransaction(
      async (tx) => {
        //* USER + PROFILE + SECURITY AS ONE NESTED WRITE. THE THREE ROWS USED
        //* TO BE THREE SEPARATE REPOSITORY CALLS FOLLOWED BY A FOURTH QUERY
        //* (findUserByEmailWithDetails) TO READ BACK WHAT HAD JUST BEEN
        //* WRITTEN; A NESTED create WITH THE FULL SELECT COLLAPSES ALL FOUR
        //* INTO ONE ROUND-TRIP AND RETURNS EXACTLY THE SHAPE
        //* UserResponseDtoWithDetails NEEDS. REGISTRATION IS A SPIKY ENDPOINT
        //* (CAMPAIGN TRAFFIC), SO THE SAVED ROUND-TRIPS ARE WORTH IT — THE
        //* ATOMICITY GUARANTEE IS UNCHANGED, IT WAS ALREADY ONE TRANSACTION.
        //*
        //* security.assignedIp IS DELIBERATELY NOT SET HERE — IT IS AN
        //* ADMIN-ASSIGNED IP ALLOWLIST VALUE AND MUST NOT BE SELF-ASSERTED
        //* FROM THIS PUBLIC ENDPOINT. SEE UpdateUserSecurityDto. lastLoginIp
        //* IS THE OBSERVED SOCKET IP FROM @Ip(), NOT CALLER INPUT.
        const fullUser = await this.userRepo.createUserWithDetails(
          {
            ...userData,
            password: hashedPassword,
            status: UserStatus.PENDING_VERIFICATION,
            profile: {
              create: {
                ...profile,
                dateOfBirth: profile.dateOfBirth
                  ? new Date(profile.dateOfBirth)
                  : undefined,
              },
            },
            security: {
              create: {
                isEmailVerified: false,
                emailVerifiedAt: null,
                lastLoginIp: ipAddress,
              },
            },
          },
          tx,
        );

        // * Persist the OTP row only — no network I/O inside the transaction.
        const plainOtp = await this.otpService.createOtp(
          fullUser.email,
          OTPType.SIGNUP,
          fullUser.id,
          tx,
        );

        return { fullUser, plainOtp };
      },
    );

    //* SENT AFTER COMMIT. THE ACCOUNT IS ALREADY CREATED AT THIS POINT, SO A
    //* MAIL-PROVIDER FAILURE HERE MUST NOT FAIL REGISTRATION — SWALLOW AND
    //* LOG. THE USER CAN STILL COMPLETE VERIFICATION VIA OtpService.verifyOtp
    //* ONCE A RESEND PATH EXISTS / THE PROVIDER RECOVERS.
    try {
      await this.otpService.sendOtp(fullUser.email, plainOtp);
    } catch (error) {
      this.logger.warn(
        `Registered ${fullUser.email} but OTP email failed to send: ${error}`,
      );
    }

    return new UserResponseDtoWithDetails(
      fullUser,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  async emailExists(email: string): Promise<boolean> {
    const existing = await this.userRepo.findUserByEmail(email);
    return !!existing;
  }

  //* FOR OTHER MODULES THAT NEED TO CREATE AN ADMIN-ONBOARDED
  //* User + Profile + UserSecurity ROW WITHOUT IMPORTING
  //* UserRepository/ProfileRepository/UserSecurityRepository DIRECTLY.
  //* `onCreated` RUNS INSIDE THE SAME TRANSACTION SO A CALLER CAN ATOMICALLY
  //* CREATE ITS OWN ROLE-SPECIFIC EXTENSION ROW ALONGSIDE THE USER.
  async createManagedUser(
    dto: {
      email: string;
      phone?: string;
      role: UserRole;
      firstName: string;
      lastName?: string;
      avatarUrl?: string;
    },
    onCreated?: (userId: number, tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<number> {
    const existing = await this.userRepo.findUserByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    return this.userRepo.withTransaction(async (tx) => {
      const user = await this.userRepo.createUser(
        {
          email: dto.email,
          phone: dto.phone,
          role: dto.role,
          status: UserStatus.ACTIVE,
          password: null,
        },
        tx,
      );

      await this.profileRepo.createUserProfile(
        {
          userId: user.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          avatarUrl: dto.avatarUrl,
        },
        tx,
      );

      await this.securityRepo.createUserSecurity(
        {
          userId: user.id,
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
        },
        tx,
      );

      if (onCreated) {
        await onCreated(user.id, tx);
      }

      return user.id;
    });
  }

  //* SAME REUSE PRINCIPLE AS createManagedUser — LETS A CALLER UPDATE
  //* Profile/User FIELDS INSIDE THE SAME TRANSACTION AS ITS OWN
  //* ROLE-SPECIFIC EXTENSION WRITE (VIA onUpdated) WITHOUT IMPORTING
  //* ProfileRepository/UserRepository DIRECTLY.
  async updateManagedUser(
    userId: number,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatarUrl?: string | null;
    },
    onUpdated?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const existingUser = await this.userRepo.findUserById(userId);
    if (!existingUser) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    await this.userRepo.withTransaction(async (tx) => {
      const profileUpdateData: Prisma.ProfileUpdateInput = {};
      if (data.firstName !== undefined) {
        profileUpdateData.firstName = data.firstName;
      }
      if (data.lastName !== undefined) {
        profileUpdateData.lastName = data.lastName;
      }
      if (data.avatarUrl !== undefined) {
        profileUpdateData.avatarUrl = data.avatarUrl;
      }

      if (Object.keys(profileUpdateData).length > 0) {
        await this.profileRepo.updateProfile(userId, profileUpdateData, tx);
      }
      if (data.phone !== undefined) {
        await this.userRepo.updateUserPhone(userId, data.phone, tx);
      }
      if (onUpdated) {
        await onUpdated(tx);
      }
    });
  }

  async getUserByEmail(email: string) {
    const existingUser = await this.userRepo.findUserByEmail(email);

    if (!existingUser) {
      throw new NotFoundException(`User with email ${email} not found.`);
    }

    return new UserResponseDto(existingUser);
  }

  async getMyProfile(id: number): Promise<UserResponseDtoWithDetails> {
    const existingUser = await this.userRepo.findUserById(id);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${id} not found.`);
    }

    return new UserResponseDtoWithDetails(
      existingUser,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  async getAllUsers(
    params: PaginationQueryDto,
  ): Promise<IPaginatedResult<UserResponseDtoWithDetails>> {
    const paginatedUsers = await this.userRepo.findAllUsers(params);

    return {
      ...paginatedUsers,
      data: paginatedUsers.data.map(
        (user) =>
          new UserResponseDtoWithDetails(
            user,
            this.configService.get<string>('app.baseUrl'),
          ),
      ),
    };
  }

  /**
   * Admin-facing user statistics. The role groupings — who counts as an
   * "admin", who counts as staff — are defined once, next to the enum they read.
   */
  async getUserStats(
    newUserWindowDays = DEFAULT_NEW_USER_WINDOW_DAYS,
  ): Promise<UserStatsDto> {
    const newSince = new Date(
      Date.now() - newUserWindowDays * MILLISECONDS_PER_DAY,
    );
    const stats = await this.userRepo.countUserStats(newSince);

    const byRole = tallyByEnum(
      Object.values(UserRole),
      stats.roleTally,
      (row) => row.role,
      (row) => row._count._all,
    );

    const endUsers = sumOf(byRole, END_USER_ROLES);

    return new UserStatsDto({
      total: stats.total,
      deleted: stats.deleted,
      byRole,
      byStatus: tallyByEnum(
        Object.values(UserStatus),
        stats.statusTally,
        (row) => row.status,
        (row) => row._count._all,
      ),
      admins: sumOf(byRole, ADMIN_ROLES),
      //* STAFF IS DERIVED AS "EVERYONE MINUS THE END USERS" RATHER THAN SUMMED
      //* FROM A LIST OF STAFF ROLES — A ROLE ADDED TO THE SCHEMA LATER IS
      //* THEN COUNTED AUTOMATICALLY INSTEAD OF SILENTLY FALLING THROUGH.
      staff: stats.total - endUsers,
      endUsers,
      verifiedEmails: stats.verifiedEmails,
      newUsers: stats.newUsers,
      newUserWindowDays,
    });
  }

  async getUserById(id: number) {
    const existingUser = await this.userRepo.findUserById(id);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${id} not found.`);
    }

    return new UserResponseDto(existingUser);
  }

  async activateUser(
    userId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<UserResponseDtoWithDetails> {
    // * Update User Status to ACTIVE
    await this.userRepo.updateUserStatusById(userId, UserStatus.ACTIVE, tx);

    // 2. Mark Email as Verified in Security Record
    await this.securityRepo.updateEmailVerification(userId, true, tx);

    const user = await this.userRepo.findUserById(userId, tx);
    if (!user) {
      throw new ConflictException('Failed to retrieve user after registration');
    }

    return new UserResponseDtoWithDetails(
      user,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  async updateUserRole(
    userId: number,
    role: UserRole,
  ): Promise<UserResponseDtoWithDetails> {
    const existingUser = await this.userRepo.findUserById(userId);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    const updatedUser = await this.userRepo.updateUserRole(userId, role);
    return new UserResponseDtoWithDetails(
      updatedUser,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  //* ADMIN-ONLY (GUARDED AT THE CONTROLLER). THE ONLY WRITE PATH FOR
  //* assignedIp — THE PUBLIC registerUser PAYLOAD CANNOT REACH IT, SEE
  //* UpdateUserSecurityDto. RETURNS THE ADMIN TIER (loginAttempts/lastLoginIp/
  //* assignedIp), WHICH IS SAFE BECAUSE ONLY ADMINS CAN CALL THIS.
  async updateUserSecurity(
    userId: number,
    dto: UpdateUserSecurityDto,
  ): Promise<UserSecurityAdminResponseDto> {
    const existingUser = await this.userRepo.findUserById(userId);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    const updatedSecurity = await this.securityRepo.updateAssignedIp(
      userId,
      dto.assignedIp,
    );

    return new UserSecurityAdminResponseDto(updatedSecurity);
  }

  async deactivateUser(userId: number): Promise<UserResponseDtoWithDetails> {
    const existingUser = await this.userRepo.findUserById(userId);

    if (!existingUser) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    if (existingUser.status === UserStatus.DEACTIVATED) {
      throw new ConflictException('User is already deactivated.');
    }

    await this.userRepo.updateUserStatusById(userId, UserStatus.DEACTIVATED);

    const updatedUser = await this.userRepo.findUserById(userId);
    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    return new UserResponseDtoWithDetails(
      updatedUser,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
    avatarFile?: Express.Multer.File,
  ): Promise<UserResponseDtoWithDetails> {
    const existingUser = await this.userRepo.findUserById(userId);
    if (!existingUser) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    const profileUpdateData: Prisma.ProfileUpdateInput = {};

    if (dto.firstName !== undefined) {
      profileUpdateData.firstName = dto.firstName;
    }
    if (dto.lastName !== undefined) {
      profileUpdateData.lastName = dto.lastName;
    }

    // * UPLOAD BEFORE THE DB WRITE SO A FAILED UPLOAD NEVER LEAVES A DANGLING
    // * avatarUrl; THE OLD FILE IS ONLY DELETED AFTER THE NEW ONE IS COMMITTED.
    let oldAvatarFilename: string | undefined;
    if (avatarFile) {
      const savedFile = await this.storageService.saveFile(
        avatarFile,
        'profiles',
      );
      profileUpdateData.avatarUrl = savedFile.path;
      if (existingUser.profile?.avatarUrl) {
        oldAvatarFilename = existingUser.profile.avatarUrl.split('/').pop();
      }
    } else if (dto.removeAvatar && existingUser.profile?.avatarUrl) {
      profileUpdateData.avatarUrl = null;
      oldAvatarFilename = existingUser.profile.avatarUrl.split('/').pop();
    }

    await this.userRepo.withTransaction(async (tx) => {
      if (Object.keys(profileUpdateData).length > 0) {
        await this.profileRepo.updateProfile(userId, profileUpdateData, tx);
      }
      if (dto.phone !== undefined) {
        await this.userRepo.updateUserPhone(userId, dto.phone, tx);
      }
    });

    if (oldAvatarFilename) {
      await this.storageService
        .deleteFile(oldAvatarFilename, 'profiles')
        .catch((e) =>
          this.logger.warn(`Could not delete old avatar file: ${e}`),
        );
    }

    const updatedUser = await this.userRepo.findUserById(userId);
    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    return new UserResponseDtoWithDetails(
      updatedUser,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  async updatePassword(
    userId: number,
    dto: UpdatePasswordDto,
  ): Promise<UserResponseDtoWithDetails> {
    const user = await this.userRepo.findUserByIdWithPassword(userId, true);

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found.`);
    }

    if (!user.password) {
      throw new BadRequestException(
        'User does not have a password set. You may have registered using a social login.',
      );
    }

    const isMatch = await this.hashService.compare(
      dto.currentPassword,
      user.password,
    );
    if (!isMatch) {
      throw new BadRequestException('Current password does not match.');
    }

    const isSameAsCurrent = await this.hashService.compare(
      dto.newPassword,
      user.password,
    );
    if (isSameAsCurrent) {
      throw new BadRequestException(
        'New password must be different from the current password.',
      );
    }

    const hashedNewPassword = await this.hashService.hash(dto.newPassword);
    const updatedUser = await this.userRepo.updatePassword(
      userId,
      hashedNewPassword,
    );

    return new UserResponseDtoWithDetails(
      updatedUser,
      this.configService.get<string>('app.baseUrl'),
    );
  }

  //* ============================ PASSWORD RESET ============================
  //*
  //* TWO PUBLIC, UNAUTHENTICATED ROUTES. THE PROOF OF OWNERSHIP IS A
  //* PASSWORD_RESET OTP MAILED TO THE ACCOUNT'S OWN ADDRESS, AND IT IS SPENT IN
  //* THE SAME REQUEST THAT WRITES THE NEW PASSWORD — SEE ResetPasswordDto FOR
  //* WHY THERE IS NO INTERMEDIATE RESET TOKEN.

  //* ALWAYS SUCCEEDS FROM THE CALLER'S POINT OF VIEW. AN UNKNOWN ADDRESS, A
  //* GOOGLE-ONLY ACCOUNT, A SUSPENDED ONE AND A REAL RESET ALL RETURN THE SAME
  //* BODY AND THE SAME @ResponseMessage — OTHERWISE THIS ROUTE IS A FREE
  //* "DOES <EMAIL> HAVE AN ACCOUNT HERE?" ORACLE FOR ANYONE WHO ASKS, WHICH IS
  //* THE INPUT TO CREDENTIAL-STUFFING AND TARGETED PHISHING ALIKE. THE REAL
  //* OUTCOME IS LOGGED SERVER-SIDE SO SUPPORT CAN STILL SEE WHAT HAPPENED.
  async requestPasswordReset(
    dto: ForgotPasswordDto,
  ): Promise<PasswordResetResponseDto> {
    const user = await this.userRepo.findUserByEmail(dto.email);

    if (!user) {
      this.logger.log(
        `Password reset requested for unknown address ${dto.email} — no mail sent.`,
      );
      return new PasswordResetResponseDto({ success: true });
    }

    //* A GOOGLE ACCOUNT HAS NO PASSWORD TO RESET (User.password IS NULL), SO
    //* ISSUING A CODE WOULD ONLY LEAD TO A DEAD END AT reset-password.
    if (user.authProvider !== AuthProvider.EMAIL) {
      this.logger.log(
        `Password reset requested for ${user.authProvider} account ${dto.email} — no mail sent.`,
      );
      return new PasswordResetResponseDto({ success: true });
    }

    //* PENDING_VERIFICATION MUST FINISH SIGNUP VERIFICATION INSTEAD; BLOCKED/
    //* SUSPENDED/DEACTIVATED MUST NOT BE HANDED A WAY BACK IN. SAME ALLOWLIST
    //* AS EVERY OTHER AUTH PATH — SEE assertAccountCanAuthenticate — BUT
    //* CHECKED, NOT THROWN, BECAUSE THE ANSWER HERE IS ALWAYS THE SAME.
    if (user.status !== UserStatus.ACTIVE) {
      this.logger.log(
        `Password reset requested for ${user.status} account ${dto.email} — no mail sent.`,
      );
      return new PasswordResetResponseDto({ success: true });
    }

    try {
      await this.otpService.issueOtp(
        user.email,
        OTPType.PASSWORD_RESET,
        user.id,
      );
    } catch (error) {
      //* SWALLOWED ON PURPOSE. THE TWO REALISTIC FAILURES ARE THE 60s
      //* PER-IDENTIFIER COOLDOWN AND A MAIL-PROVIDER HICCUP; SURFACING EITHER
      //* WOULD ANSWER "DOES THIS ADDRESS EXIST?" (ONLY A REAL ACCOUNT CAN BE
      //* ON COOLDOWN). THE CLIENT MIRRORS THE COOLDOWN AS A COUNTDOWN SO A
      //* HUMAN NEVER REACHES THIS BRANCH BY ACCIDENT.
      this.logger.warn(
        `Password reset OTP for ${dto.email} was not sent: ${error}`,
      );
    }

    return new PasswordResetResponseDto({ success: true });
  }

  //* THE CODE IS SPENT AND THE PASSWORD IS WRITTEN IN ONE TRANSACTION: A BURN
  //* THAT COMMITTED WITHOUT THE WRITE WOULD STRAND THE USER (VALID CODE GONE,
  //* PASSWORD UNCHANGED), AND A WRITE THAT COMMITTED WITHOUT THE BURN WOULD
  //* LEAVE A REPLAYABLE CODE THAT COULD SET THE PASSWORD AGAIN LATER.
  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<PasswordResetResponseDto> {
    const user = await this.userRepo.findUserByEmailWithPassword(
      dto.email,
      true,
    );

    //* ONE MESSAGE FOR EVERY PRE-CODE REJECTION — UNKNOWN ADDRESS, OAUTH-ONLY
    //* ACCOUNT, NON-ACTIVE ACCOUNT — SO THIS ROUTE CANNOT BE USED TO PROBE FOR
    //* ACCOUNTS EITHER. IT IS ALSO THE SAME SHAPE OF ANSWER findMatchingOtp
    //* GIVES FOR A WRONG CODE.
    if (
      !user ||
      !user.password ||
      user.authProvider !== AuthProvider.EMAIL ||
      user.status !== UserStatus.ACTIVE
    ) {
      this.logger.warn(
        `Password reset submitted for an ineligible account: ${dto.email}`,
      );
      throw new BadRequestException(
        'This reset code is invalid or has expired. Please request a new one.',
      );
    }

    //* THROWS FOR A MISSING/EXPIRED/NON-MATCHING CODE. THE BCRYPT COMPARE RUNS
    //* HERE, OUTSIDE THE TRANSACTION OPENED BELOW.
    const otpRecord = await this.otpService.findMatchingOtp(
      user.email,
      dto.code,
      OTPType.PASSWORD_RESET,
    );

    //* SAME RULE AS updatePassword. WORTH KEEPING ON THIS PATH TOO: SOMEONE WHO
    //* "FORGOT" THEIR PASSWORD AND TYPES THE ONE THEY ALREADY HAVE IS BETTER
    //* TOLD SO THAN SILENTLY NO-OPPED.
    const isSameAsCurrent = await this.hashService.compare(
      dto.newPassword,
      user.password,
    );
    if (isSameAsCurrent) {
      throw new BadRequestException(
        'New password must be different from the current password.',
      );
    }

    const hashedNewPassword = await this.hashService.hash(dto.newPassword);

    await this.userRepo.withTransaction(async (tx) => {
      await this.otpService.markOtpUsed(otpRecord.id, tx);
      await this.userRepo.updatePassword(user.id, hashedNewPassword, tx);
    });

    this.logger.log(`Password reset completed for user ${user.id}`);

    //* NO SESSION IS MINTED HERE, UNLIKE THE SIGNUP-OTP PATH. THE USER SIGNS IN
    //* WITH THE PASSWORD THEY JUST CHOSE, WHICH IS ALSO THE ONLY WAY THEY FIND
    //* OUT IMMEDIATELY IF IT DIDN'T SAVE.
    return new PasswordResetResponseDto({ success: true });
  }

  //* PER-REQUEST TOKEN CHECK — SEE JwtStrategy.validate. RETURNS THE RAW ROW
  //* (NOT A UserResponseDto) BECAUSE THE CALLER ONLY NEEDS status/deletedAt
  //* PLUS THE IDENTITY FIELDS, AND THIS RUNS ON EVERY GUARDED REQUEST.
  //* RETURNS null FOR A MISSING USER INSTEAD OF THROWING NotFoundException —
  //* AN UNKNOWN sub IN A TOKEN IS AN AUTH FAILURE, NOT A 404.
  async getAuthStateById(userId: number) {
    return this.userRepo.findAuthStateById(userId);
  }

  async findForAuth(email: string) {
    const user = await this.userRepo.findUserByEmailWithPassword(email, true);

    return user;
  }

  async updateLoginAttempts(userId: number, tx?: Prisma.TransactionClient) {
    const result = await this.securityRepo.incrementLoginAttempts(userId, tx);
    if (!result.userId) {
      throw new NotFoundException('User not found to update login attempts');
    }
    return new UserSecurityMeResponseDto(result);
  }

  async updateLoginSuccess(
    userId: number,
    ip?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const result = await this.securityRepo.updateLoginMetadata(userId, ip, tx);
    if (!result.userId) {
      throw new NotFoundException('User not found to update login time');
    }
    return result;
  }

  async updateLastLoginTime(
    userId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<UserResponseDto> {
    const user = await this.userRepo.updateLastLoginTime(userId, tx);
    if (!user) {
      throw new NotFoundException('User not found to update login time');
    }
    return new UserResponseDto(user);
  }

  //* CALLED BY AuthService.socialAuth. THE OAUTH PROVIDER HAS ALREADY PROVEN
  //* OWNERSHIP OF `dto.email`, SO A MATCH IS LOGGED IN DIRECTLY (NO PASSWORD
  //* CHECK) AND A MISS IS SILENTLY REGISTERED — NO OTP, ALREADY VERIFIED.
  async findOrCreateSocialUser(
    dto: VerifiedSocialProfile,
    ipAddress?: string,
  ): Promise<UserResponseDto> {
    const existing = await this.userRepo.findUserByEmail(dto.email);

    if (!existing) {
      return this.userRepo.withTransaction(async (tx) => {
        const user = await this.userRepo.createUser(
          {
            email: dto.email,
            authProvider: dto.provider,
            providerId: dto.providerId,
            status: UserStatus.ACTIVE,
          },
          tx,
        );

        await this.profileRepo.createUserProfile(
          {
            userId: user.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            avatarUrl: dto.image,
          },
          tx,
        );

        await this.securityRepo.createUserSecurity(
          {
            userId: user.id,
            isEmailVerified: true,
            emailVerifiedAt: new Date(),
            lastLoginIp: ipAddress,
          },
          tx,
        );

        return new UserResponseDto(user);
      });
    }

    if (existing.status === UserStatus.PENDING_VERIFICATION) {
      // * The provider already verified this email — finish the
      // * signup-verification step the user never completed via OTP.
      await this.activateUser(existing.id);
    } else {
      //* SAME GATE AS PASSWORD LOGIN. A VALID GOOGLE TOKEN PROVES WHO YOU ARE,
      //* NOT THAT THE ACCOUNT IS STILL ALLOWED IN — A DEACTIVATED (SOFT-DELETED)
      //* USER MUST NOT BE ABLE TO WALK BACK IN THROUGH SOCIAL SIGN-IN.
      assertAccountCanAuthenticate(existing.status);
    }

    await this.updateLoginSuccess(existing.id, ipAddress);
    await this.updateLastLoginTime(existing.id);

    return new UserResponseDto(existing);
  }
}
