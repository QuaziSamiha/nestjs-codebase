import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '../../generated/prisma/enums';

//* SINGLE SOURCE OF TRUTH FOR "MAY THIS ACCOUNT HOLD A SESSION?". EVERY PATH
//* THAT MINTS OR HONOURS A TOKEN MUST GO THROUGH HERE — PASSWORD LOGIN, SOCIAL
//* LOGIN, THE OTP-VERIFIED HAND-OFF, REFRESH, AND THE PER-REQUEST JWT CHECK.
//*
//* IT IS AN ALLOWLIST (ONLY ACTIVE PASSES), NOT A DENYLIST, ON PURPOSE: THE
//* OLD "IS IT BLOCKED OR SUSPENDED?" CHECKS SILENTLY LET DEACTIVATED — THE
//* STATUS THE ADMIN SOFT-DELETE WRITES (UserService.deactivateUser) — LOG IN,
//* AND WOULD DO THE SAME FOR ANY UserStatus ADDED TO THE SCHEMA LATER.
export function assertAccountCanAuthenticate(status: UserStatus): void {
  switch (status) {
    case UserStatus.ACTIVE:
      return;

    case UserStatus.PENDING_VERIFICATION:
      throw new UnauthorizedException(
        'Account is not active. Please verify your email before logging in',
      );

    case UserStatus.BLOCKED:
    case UserStatus.SUSPENDED:
      throw new ForbiddenException(`Account is ${status.toLowerCase()}`);

    //* SOFT-DELETED / RETIRED ACCOUNTS. DELIBERATELY VAGUE ABOUT *WHICH* OF
    //* THE THREE IT IS — THE DISTINCTION IS AN INTERNAL ADMIN CONCERN AND
    //* LEAKING IT ONLY HELPS SOMEONE PROBING SOMEBODY ELSE'S ACCOUNT.
    case UserStatus.DEACTIVATED:
    case UserStatus.INACTIVE:
    case UserStatus.ARCHIVED:
      throw new ForbiddenException(
        'This account has been deactivated. Please contact support if you believe this is a mistake.',
      );

    default:
      throw new UnauthorizedException('Account is not active');
  }
}
