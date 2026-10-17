import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { OTPType } from '../../generated/prisma/enums';

//* ONE TEMPLATE (templates/otp.hbs), ONE COPY BLOCK PER OTPType. THE WORDING IS
//* NOT COSMETIC: A PASSWORD-RESET CODE ARRIVING UNDER "VERIFY YOUR EMAIL" GIVES
//* THE RECIPIENT NO WAY TO TELL A RESET THEY DIDN'T ASK FOR FROM ROUTINE SIGNUP
//* MAIL, WHICH IS EXACTLY THE SIGNAL THEY NEED WHEN SOMEONE IS TRYING TO TAKE
//* THE ACCOUNT OVER. ADDING AN OTPType MEANS ADDING AN ENTRY HERE — THE
//* Record<OTPType, ...> TYPE MAKES A MISSING ONE A COMPILE ERROR, NOT A
//* SILENTLY-WRONG EMAIL.
const buildOtpEmailCopy = (
  appName: string,
): Record<
  OTPType,
  { subject: string; title: string; intro: string; unsolicited: string }
> => ({
  [OTPType.SIGNUP]: {
    subject: `Verify Your Email - ${appName}`,
    title: 'Verify Your Email',
    intro: `Thank you for choosing ${appName}. Use the following One-Time Password (OTP) to complete your verification process:`,
    unsolicited: 'If you did not request this code, please ignore this email.',
  },
  [OTPType.PASSWORD_RESET]: {
    subject: `Reset Your Password - ${appName}`,
    title: 'Reset Your Password',
    intro: `We received a request to reset the password for your ${appName} account. Use the following One-Time Password (OTP) to set a new password:`,
    unsolicited:
      'If you did not request a password reset, you can safely ignore this email — your password will not change until this code is used.',
  },
  [OTPType.LOGIN_2FA]: {
    subject: `Your Login Code - ${appName}`,
    title: 'Confirm Your Login',
    intro: `Use the following One-Time Password (OTP) to finish signing in to your ${appName} account:`,
    unsolicited:
      'If you did not try to sign in, please change your password immediately.',
  },
  [OTPType.PHONE_CHANGE]: {
    subject: `Confirm Your Phone Number - ${appName}`,
    title: 'Confirm Your Phone Number',
    intro: `Use the following One-Time Password (OTP) to confirm the new phone number on your ${appName} account:`,
    unsolicited:
      'If you did not request this change, please ignore this email.',
  },
});

@Injectable()
export class MailService {
  private readonly appName: string;
  private readonly otpEmailCopy: ReturnType<typeof buildOtpEmailCopy>;

  constructor(
    private readonly mailerService: MailerService,
    configService: ConfigService,
  ) {
    this.appName = configService.get<string>('APP_NAME') ?? 'My App';
    this.otpEmailCopy = buildOtpEmailCopy(this.appName);
  }

  private readonly logger = new Logger(MailService.name);

  async sendOtpEmail(
    email: string,
    otpCode: string,
    type: OTPType = OTPType.SIGNUP,
  ) {
    const copy = this.otpEmailCopy[type] ?? this.otpEmailCopy[OTPType.SIGNUP];

    try {
      await this.mailerService.sendMail({
        to: email,
        subject: copy.subject,
        template: './otp', // Points to templates/otp.hbs
        context: {
          otpCode, // This replaces {{otpCode}} in the Handlebars file
          title: copy.title,
          intro: copy.intro,
          unsolicited: copy.unsolicited,
          appName: this.appName,
          year: new Date().getFullYear(),
        },
      });
      return true;
    } catch (error: unknown) {
      const err = error as {
        code?: string;
        response?: string;
        message?: string;
      };
      if (err?.code === 'EAUTH') {
        this.logger.error(
          `SMTP authentication failed (${err.response || err.message || 'Unknown error'}). Check MAIL_USERNAME/MAIL_PASSWORD.`,
        );
      } else {
        this.logger.error(
          `Email sending failed: ${err?.message || 'Unknown error'}`,
        );
      }
      return false;
    }
  }
}
