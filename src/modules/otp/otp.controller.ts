import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OtpService } from './otp.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response/response-message.decorator';
import {
  OTP_RESEND_THROTTLE,
  OTP_VERIFY_THROTTLE,
  THROTTLER_SHORT,
} from '../../common/throttler/throttler.constants';

@ApiTags('OTP')
@Controller('otp')
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  //* OTP GUESSING IS THE WHOLE THREAT MODEL FOR A 6-DIGIT CODE — 5 TRIES PER 5 MINUTES
  //* PER IP, THEN A 15-MINUTE BLOCK. NOTE THIS IS THE PER-IP HALF ONLY: A GUESSER SPREAD
  //* ACROSS MANY IPs DEFEATS IT, AND THE PER-OTP ATTEMPT CAP THAT WOULD STOP THAT IS
  //* NOT IMPLEMENTED — SEE docs/concepts/rate-limiting.md §7.3.
  @Throttle({ [THROTTLER_SHORT]: OTP_VERIFY_THROTTLE })
  @Post('verify-otp')
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiOperation({ summary: 'Verify user email with OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({
    status: 429,
    description:
      'Too many OTP attempts from this IP. Limit is 5 per 5 minutes, then a 15-minute block.',
  })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('OTP verified successfully')
  async verify(@Body() dto: VerifyOtpDto) {
    return this.otpService.verifyOtp(dto);
  }

  //* ISSUANCE COSTS A REAL OUTBOUND EMAIL, SAME AS SIGNUP. OtpService ALSO ENFORCES
  //* RESEND_COOLDOWN_SECONDS PER IDENTITY; THIS IS THE PER-IP CEILING ON TOP OF IT, WHICH
  //* THAT COOLDOWN ALONE DOESN'T GIVE YOU — IT IS KEYED BY IDENTIFIER, SO ONE CALLER
  //* CYCLING THROUGH ADDRESSES NEVER TRIPS IT.
  @Throttle({ [THROTTLER_SHORT]: OTP_RESEND_THROTTLE })
  @Post('resend-otp')
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiOperation({ summary: 'Resend a fresh OTP code to the user' })
  @ApiBody({ type: ResendOtpDto })
  @ApiResponse({
    status: 429,
    description: 'Too many OTP requests from this IP. Limit is 3 per hour.',
  })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('OTP resent successfully')
  async resend(@Body() dto: ResendOtpDto) {
    return this.otpService.resendOtp(dto);
  }
}
