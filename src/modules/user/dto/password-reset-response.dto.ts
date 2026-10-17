import { ApiProperty } from '@nestjs/swagger';

//* DELIBERATELY CARRIES NOTHING BUT `success`. BOTH PASSWORD-RESET ROUTES
//* ANSWER IDENTICALLY WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT — ANY FIELD
//* THAT VARIED WITH THE LOOKUP (A userId, A MASKED EMAIL, A "sent" FLAG) WOULD
//* TURN THE PUBLIC forgot-password ROUTE BACK INTO A USER-ENUMERATION ORACLE,
//* WHICH IS THE ONE THING ITS GENERIC MESSAGE EXISTS TO PREVENT.
export class PasswordResetResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  constructor(partial: Partial<PasswordResetResponseDto>) {
    Object.assign(this, partial);
  }
}
