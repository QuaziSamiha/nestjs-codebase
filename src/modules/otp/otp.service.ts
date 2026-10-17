import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpRepository } from './otp.repository';
import { OTPType, UserStatus } from '../../generated/prisma/enums';
import { HashService } from '../../shared/hash/hash.service';
import * as crypto from 'crypto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { UserService } from '../user/user.service';
import { AuthService } from '../auth/auth.service';
import { TokensResponseDto } from '../auth/dto/token-response.dto';
import { VerifyOtpResponseDto } from './dto/verify-otp-response.dto';
import { Prisma } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  //* MINIMUM GAP BETWEEN TWO OTPS FOR THE SAME identifier+type — STOPS
  //* resendOtp FROM BEING USED TO SPAM AN INBOX / HAMMER THE MAIL PROVIDER.
  private readonly RESEND_COOLDOWN_SECONDS = 60;

  constructor(
    private readonly otpRepo: OtpRepository,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly hashService: HashService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  //* DB-ONLY HALF OF OTP ISSUANCE — SAFE TO CALL INSIDE AN INTERACTIVE
  //* TRANSACTION (tx) SINCE IT NEVER PERFORMS NETWORK I/O. CALLERS THAT ALSO
  //* NEED THE EMAIL SENT MUST CALL sendOtp() SEPARATELY, AFTER THEIR
  //* TRANSACTION COMMITS — SEE generateAndSendOtp's COMMENT FOR WHY.
  async createOtp(
    identifier: string,
    type: OTPType,
    userId?: number,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    try {
      // * Generate a cryptographically secure 6-digit number (100000 - 999999)
      const plainOtp = crypto.randomInt(100000, 999999).toString();

      this.logger.debug(`[DEV MODE] OTP for ${identifier}: ${plainOtp}`);

      // * Hash the OTP before saving
      const hashedOtp = await this.hashService.hash(plainOtp);

      // * Set expiration (e.g., 10 minutes from now)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      // * Save to Database
      await this.otpRepo.createOTP(
        {
          code: hashedOtp,
          type,
          identifier,
          userId,
          expiresAt,
        },
        tx,
      );

      return plainOtp;
    } catch (error) {
      this.logger.error('OTP Generation Error', error);
      throw new InternalServerErrorException('Failed to process OTP request');
    }
  }

  //* NETWORK-ONLY HALF OF OTP ISSUANCE. NEVER CALL THIS FROM INSIDE A DB
  //* TRANSACTION — PRISMA'S INTERACTIVE $transaction HAS A DEFAULT 5S TIMEOUT,
  //* AND HOLDING IT OPEN ACROSS AN SMTP ROUND-TRIP MEANS ANY MAIL-PROVIDER
  //* LATENCY SPIKE THROWS P2028 AND ROLLS BACK AN OTHERWISE-VALID DB WRITE.
  async sendOtp(
    identifier: string,
    plainOtp: string,
    type: OTPType = OTPType.SIGNUP,
  ) {
    // In development, we allow console-only OTP flow as a fallback.
    const isMailSent = await this.mailService.sendOtpEmail(
      identifier,
      plainOtp,
      type,
    );
    const isDev =
      this.configService.get<string>('NODE_ENV') === 'development';
    if (!isMailSent && !isDev) {
      throw new InternalServerErrorException('Failed to send OTP email');
    }

    return new VerifyOtpResponseDto({
      success: true,
      message: `OTP sent to ${identifier}`,
    });
  }

  //* CONVENIENCE WRAPPER FOR CALLERS THAT ARE NOT ALREADY INSIDE A DB
  //* TRANSACTION. A CALLER THAT NEEDS TO SAVE THE OTP AS PART OF ITS OWN
  //* TRANSACTION (E.G. UserService.registerUser) MUST NOT USE THIS — CALL
  //* createOtp(..., tx) INSIDE THE TRANSACTION, THEN sendOtp() AFTER IT
  //* COMMITS, SO EMAIL LATENCY CAN NEVER ROLL BACK THE DB WRITE.
  async generateAndSendOtp(
    identifier: string,
    type: OTPType,
    userId?: number,
    tx?: Prisma.TransactionClient,
  ) {
    const plainOtp = await this.createOtp(identifier, type, userId, tx);
    return this.sendOtp(identifier, plainOtp, type);
  }

  //* ISSUANCE WITH THE PER-IDENTITY COOLDOWN APPLIED — THE ENTRY POINT FOR ANY
  //* FLOW WHERE THE *USER* ASKS FOR A CODE (RESEND, FORGOT PASSWORD), AS
  //* OPPOSED TO ONE THE SERVER ISSUES AS PART OF ANOTHER ACTION (REGISTRATION).
  //* THROWS BadRequestException WHILE THE COOLDOWN IS STILL RUNNING.
  async issueOtp(identifier: string, type: OTPType, userId?: number) {
    await this.assertResendCooldownElapsed(identifier, type);

    const plainOtp = await this.createOtp(identifier, type, userId);
    return this.sendOtp(identifier, plainOtp, type);
  }

  //* KEYED BY identifier+type, NOT BY IP — TWO DIFFERENT FLOWS FOR THE SAME
  //* ADDRESS (E.G. A SIGNUP RESEND AND A PASSWORD RESET) DON'T BLOCK EACH
  //* OTHER, BUT NEITHER CAN BE USED TO REPEATEDLY MAIL THE SAME INBOX.
  private async assertResendCooldownElapsed(identifier: string, type: OTPType) {
    const latestOtp = await this.otpRepo.findLatestValidOtp(identifier, type);
    if (!latestOtp) return;

    const elapsedSeconds = (Date.now() - latestOtp.createdAt.getTime()) / 1000;
    if (elapsedSeconds < this.RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(
        this.RESEND_COOLDOWN_SECONDS - elapsedSeconds,
      );
      throw new BadRequestException(
        `Please wait ${waitSeconds}s before requesting another OTP.`,
      );
    }
  }

  //* MATCH WITHOUT BURNING. SPLIT OUT OF verifyOtp SO A CALLER THAT MUST BURN
  //* THE CODE INSIDE ITS *OWN* TRANSACTION (UserService.resetPassword — THE
  //* BURN AND THE PASSWORD WRITE HAVE TO COMMIT TOGETHER) CAN STILL PAY THE
  //* BCRYPT COMPARE OUTSIDE IT. NEVER CALL THIS WITHOUT CALLING markOtpUsed ON
  //* THE RETURNED ROW — AN UNBURNED CODE IS A REPLAYABLE ONE.
  async findMatchingOtp(identifier: string, code: string, type: OTPType) {
    const otpRecord = await this.otpRepo.findLatestValidOtp(identifier, type);

    if (!otpRecord) {
      throw new BadRequestException(
        'OTP has expired or does not exist. Please request a new one.',
      );
    }

    const isMatch = await this.hashService.compare(code, otpRecord.code);
    if (!isMatch) {
      throw new BadRequestException('Invalid OTP code.');
    }

    return otpRecord;
  }

  async markOtpUsed(otpId: number, tx?: Prisma.TransactionClient) {
    return this.otpRepo.markAsUsed(otpId, tx);
  }

  //* SELF-SERVE RECOVERY PATH FOR THE POST-COMMIT SEND IN
  //* UserService.registerUser (AND ANY OTHER createOtp/sendOtp CALLER):
  //* IF THE FIRST EMAIL NEVER ARRIVES (PROVIDER HICCUP, SPAM FOLDER), THE
  //* ACCOUNT/OTP ROW ALREADY EXISTS — THIS JUST ISSUES A FRESH CODE RATHER
  //* THAN MAKING THE USER RE-REGISTER.
  async resendOtp(dto: ResendOtpDto): Promise<VerifyOtpResponseDto> {
    const { identifier, type } = dto;

    // * Throws NotFoundException if no account exists for this identifier.
    const user = await this.userService.getUserByEmail(identifier);

    if (type === OTPType.SIGNUP && user.status !== UserStatus.PENDING_VERIFICATION) {
      throw new BadRequestException(
        'This account is already verified. No need to resend an OTP.',
      );
    }

    return this.issueOtp(identifier, type, user.id);
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const { identifier, type, code } = dto;

    const user = await this.userService.getUserByEmail(identifier);

    if (!user) {
      throw new NotFoundException(
        `No account found with identifier: ${identifier}`,
      );
    }

    //* THROWS FOR AN EXPIRED/MISSING/NON-MATCHING CODE. THE BCRYPT COMPARE
    //* DELIBERATELY HAPPENS HERE, BEFORE THE TRANSACTION BELOW OPENS.
    const otpRecord = await this.findMatchingOtp(identifier, code, type);

    // * "Burn" the OTP so it cannot be used again (Atomic security)
    // await this.otpRepo.markAsUsed(otpRecord.id);
    // * TRANSACTIONAL UPDATE (Senior Move)
    await this.otpRepo.withTransaction(async (tx) => {
      // * Burn the OTP so it's a one-time use
      await this.otpRepo.markAsUsed(otpRecord.id, tx);

      // * If it's a signup, activate the user via the service
      if (type === OTPType.SIGNUP) {
        await this.userService.activateUser(user.id, tx);
      }
    });

    //* SIGNUP ONLY: HAND BACK A REAL SESSION SO THE USER LANDS LOGGED IN
    //* INSTEAD OF BEING BOUNCED TO A SIGN-IN FORM SECONDS AFTER PROVING THEY
    //* OWN THE ADDRESS. THE BURNED OTP ABOVE IS THE OWNERSHIP PROOF — SEE
    //* AuthService.issueTokensForVerifiedUser. ISSUED AFTER THE TRANSACTION
    //* COMMITS BECAUSE activateUser's ACTIVE STATUS MUST BE VISIBLE TO THE
    //* STATUS CHECK INSIDE IT.
    //*
    //* DELIBERATELY NOT DONE FOR PASSWORD_RESET/LOGIN_2FA/PHONE_CHANGE —
    //* THOSE HAVE THEIR OWN FOLLOW-UP STEPS AND MUST NOT SILENTLY MINT A
    //* SESSION AS A SIDE EFFECT OF CODE ENTRY.
    let tokens: TokensResponseDto | undefined;
    if (type === OTPType.SIGNUP) {
      tokens = await this.authService.issueTokensForVerifiedUser(user.id);
    }

    return new VerifyOtpResponseDto({
      success: true,
      userId: otpRecord.userId ?? undefined,
      message: 'OTP verified successfully',
      data: tokens,
    });
  }
}
