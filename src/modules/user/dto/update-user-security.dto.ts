import { ApiProperty } from '@nestjs/swagger';
import { IsIP, ValidateIf } from 'class-validator';

//* ADMIN-ONLY PAYLOAD. assignedIp IS AN IP-ALLOWLIST VALUE FOR INTERNAL
//* RESTRICTED ACCESS, SO IT MUST NEVER BE REACHABLE FROM THE PUBLIC,
//* UNAUTHENTICATED REGISTRATION PAYLOAD — A SELF-CHOSEN VALUE SITTING IN THE
//* ROW FROM DAY ONE WOULD DEFEAT ANY IP RESTRICTION LATER BUILT ON TOP OF IT
//* (E.G. IF THE ACCOUNT IS PROMOTED TO A RESTRICTED ROLE AFTERWARDS). IT IS
//* SETTABLE ONLY VIA PATCH /user/update-user-security/:id, WHICH IS BEHIND
//* JwtAuthGuard + RolesGuard(ADMIN). SEE CreateUserDto FOR THE SAME REASONING
//* APPLIED TO authProvider/providerId.
export class UpdateUserSecurityDto {
  @ApiProperty({
    description:
      'A static IPv4 address assigned to a user (e.g., for restricted Admin or Vendor access). Send `null` to clear it.',
    example: '192.168.1.100',
    type: String,
    nullable: true,
  })
  //* null IS THE EXPLICIT "CLEAR IT" SIGNAL AND SKIPS THE IP CHECK; ANYTHING
  //* ELSE — INCLUDING A MISSING KEY — MUST BE A VALID IPv4. @IsOptional IS
  //* DELIBERATELY NOT USED: IT WOULD ALSO SKIP undefined AND TURN AN EMPTY
  //* BODY INTO A SILENT NO-OP INSTEAD OF A 400.
  @ValidateIf((_object, value) => value !== null)
  @IsIP(4)
  assignedIp!: string | null;
}
