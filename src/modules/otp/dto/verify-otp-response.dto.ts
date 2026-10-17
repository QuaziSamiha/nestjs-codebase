import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 16, description: 'The ID of the verified user' })
  userId!: number;

  @ApiProperty({ example: 'OTP verified successfully' })
  message!: string;

  // Optional: If this is for a password reset, you might return a temp token
  // @ApiProperty({ required: false, example: 'eyJhbGci...' })
  // resetToken?: string;
  // Add this field to hold the login data
  @ApiProperty({ required: false })
  data?: {
    access_token: string;
    refresh_token: string;
  };

  constructor(partial: Partial<VerifyOtpResponseDto>) {
    Object.assign(this, partial);
  }
}
