import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '../../../generated/prisma/enums';
import { assertAccountCanAuthenticate } from '../account-status.util';

describe('assertAccountCanAuthenticate', () => {
  it('lets an ACTIVE account through', () => {
    expect(() => assertAccountCanAuthenticate(UserStatus.ACTIVE)).not.toThrow();
  });

  //* THE REGRESSION THIS FILE EXISTS FOR: deactivateUser (ADMIN SOFT DELETE)
  //* WRITES DEACTIVATED, AND THE OLD BLOCKED/SUSPENDED-ONLY CHECKS LET THAT
  //* ACCOUNT LOG STRAIGHT BACK IN.
  it.each([UserStatus.DEACTIVATED, UserStatus.INACTIVE, UserStatus.ARCHIVED])(
    'rejects a soft-deleted/retired account (%s) with 403',
    (status) => {
      expect(() => assertAccountCanAuthenticate(status)).toThrow(
        ForbiddenException,
      );
    },
  );

  it.each([UserStatus.BLOCKED, UserStatus.SUSPENDED])(
    'rejects a %s account with 403',
    (status) => {
      expect(() => assertAccountCanAuthenticate(status)).toThrow(
        ForbiddenException,
      );
    },
  );

  it('rejects an unverified account with 401', () => {
    expect(() =>
      assertAccountCanAuthenticate(UserStatus.PENDING_VERIFICATION),
    ).toThrow(UnauthorizedException);
  });

  //* ALLOWLIST GUARANTEE: A UserStatus ADDED TO THE SCHEMA LATER IS DENIED
  //* UNTIL SOMEONE DELIBERATELY LISTS IT ABOVE.
  it('denies every status that is not ACTIVE', () => {
    const denied = Object.values(UserStatus).filter(
      (status) => status !== UserStatus.ACTIVE,
    );

    for (const status of denied) {
      expect(() => assertAccountCanAuthenticate(status)).toThrow();
    }
  });
});
