import { UserRole } from '../../../generated/prisma/enums';

export interface IJwtPayload {
  sub: number; // * User ID - The unique User ID from the database (Subject)
  email: string;
  role: UserRole;
}

export interface ITokens {
  access_token: string;
  refresh_token: string;
}

/**
The Standard: RFC 7519
The JWT specification defines a few "Registered Claim Names." These are reserved three-letter keys designed to keep 
the token payload (the "claim") as small as possible.

sub (Subject): The unique identifier for the user. According to the spec, the subject must be locally unique or globally unique.
iss (Issuer): Who created the token (e.g., https://api.example.com).
exp (Expiration): When the token dies.
iat (Issued At): When the token was born.
 */
