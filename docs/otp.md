# OTP Module

One-time-code generation and verification — currently wired for exactly one purpose (signup email verification) despite the schema, DTOs, and response shapes all being built to support more. Like `mail.md`, this doc spends real space on the gap between what the module's types/enums imply it can do and what actually has a caller today: three of the four `OTPType` values are fully theoretical (no code anywhere ever creates or meaningfully verifies them), the response DTO has an unpopulated auto-login `data` field, and — because `mail.md`'s finding holds here too — the email that's supposed to deliver the code is never sent, so this module's only real-world distribution channel for the plaintext OTP is a debug log line.

Module source: `src/modules/otp/` (`otp.controller.ts`, `otp.service.ts`, `otp.repository.ts`, `otp.module.ts`, `dto/`, `entities/otp.entity.ts`).

> **Scope note:** the `OTP` Prisma model itself (fields, index, table name) is documented in [`user.md`](./user.md#data-dictionary--otp) as part of the User-domain schema file (`prisma/schema/user.prisma`) — it is not redocumented here. `User`/`UserSecurity` are also documented there. `MailService` is documented in [`mail.md`](./mail.md) — its one relevant fact here is restated because it directly explains this module's behavior: the OTP email is never actually sent.

---

### Architecture Overview

#### Generation Pipeline (`OtpService.generateAndSendOtp`)

| Step               | Implementation                                                                                                     |
| :-------------------- | :----------------------------------------------------------------------------------------------------------------- |
| **Code generation**    | `crypto.randomInt(100000, 999999).toString()` — Node's `crypto.randomInt` upper bound is **exclusive**, so the real keyspace is `100000`–`999998` (899,999 values), one short of the 900,000 the call appears to promise. |
| **Plaintext logging**   | `this.logger.debug(\`[DEV MODE] OTP for ${identifier}: ${plainOtp}\`)` — fired **unconditionally**, immediately after generation, with no `NODE_ENV` gate despite the `[DEV MODE]` label. See [Known Gaps](#known-gaps--recommended-hardening). |
| **Hashing**             | `HashService.hash(plainOtp)` — bcrypt, salt rounds from `app.saltRounds` config (default `10`). Same service `UserService`/`AuthService` use for passwords.                                                    |
| **Expiry**              | `new Date()` + 10 minutes (`setMinutes(getMinutes() + 10)`) — hardcoded, not configurable via env.                                                                                                              |
| **Persistence**         | `OtpRepository.createOTP({ code: hashedOtp, type, identifier, userId, expiresAt }, tx)` — a plain `INSERT`, no check for or invalidation of a prior outstanding OTP for the same `identifier`+`type`.           |
| **Delivery**            | **Does not happen.** The `MailService.sendOtpEmail(identifier, plainOtp)` call — along with its injection and the dev/prod branch that would throw on a real send failure — is entirely commented out (`otp.service.ts` lines ~66–76). See [`mail.md`](./mail.md#known-gaps--recommended-hardening). |
| **Response**            | `new VerifyOtpResponseDto({ success: true, message: \`OTP sent to ${identifier}\` })` — returned regardless of the fact that no email was sent. |

#### Verification Pipeline (`OtpService.verifyOtp`)

| Step                  | Implementation                                                                                                                                  |
| :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resolve the account**   | `UserService.getUserByEmail(identifier)` — throws deep inside `UserService` if no match (see [Known Gaps](#known-gaps--recommended-hardening) for the dead duplicate check that follows it). |
| **Find the OTP**          | `OtpRepository.findLatestValidOtp(identifier, type)` — `findFirst` with `where: { identifier, type, isUsed: false, expiresAt: { gt: now } }`, `orderBy: { createdAt: 'desc' }`. Correctly picks the newest matching row when several exist. `null` → `400`. |
| **Check the code**        | `HashService.compare(code, otpRecord.code)` (bcrypt). Mismatch → `400`.                                                                          |
| **Burn + side effect**    | Inside one transaction (`otpRepo.withTransaction`): `markAsUsed(otpRecord.id, tx)`, then — **only** when `type === OTPType.SIGNUP` — `UserService.activateUser(user.id, tx)` (flips `User.status` to `ACTIVE`, `UserSecurity.isEmailVerified` to `true`; documented in `user.md`). |
| **Response**              | `new VerifyOtpResponseDto({ success: true, userId: otpRecord.userId ?? undefined, message: 'OTP verified successfully' })` — `data` (access/refresh tokens) is declared on the DTO but never assigned. See [Known Gaps](#known-gaps--recommended-hardening). |

#### `OTPType` Reachability

| Value            | Generated by      | Verified/acted on by                          | Status                                                                 |
| :------------------ | :------------------- | :----------------------------------------------- | :--------------------------------------------------------------------------- |
| `SIGNUP`             | `UserService.registerUser` (the only live caller of `generateAndSendOtp` in the entire codebase) | `verifyOtp`'s `if (type === SIGNUP)` branch → `UserService.activateUser` | **The only fully wired type.**                                                |
| `PASSWORD_RESET`     | No caller anywhere.  | `verifyOtp` would burn the OTP but take no further action. | Enum value only — no row of this type can ever exist, so verifying it always `400`s ("does not exist"). Matches `auth.md`'s finding that no password-reset flow exists at all. |
| `LOGIN_2FA`          | No caller anywhere.  | Same as above — dead-end branch.                   | Enum value only.                                                              |
| `PHONE_CHANGE`       | No caller anywhere.  | Same as above — dead-end branch.                   | Enum value only. Notably `VerifyOtpDto.identifier` is hard-validated as `@IsEmail()`, so even if a phone-based flow were wired up, a phone-number identifier would currently fail DTO validation before reaching the service. |

#### Guest / Anonymous OTP

`OTP.userId` is nullable (for identifiers not yet tied to an account) per the schema (see `user.md`). **In practice it is never null today** — the only live caller, `registerUser`, always passes a freshly-created `user.id` into `generateAndSendOtp`. A guest OTP row is a schema capability with no code path that exercises it.

---

### Known Gaps / Recommended Hardening

Ranked roughly by how much it matters before this module is trusted for a real signup flow.

1. **No online rate limiting or per-attempt lockout on verification.** `POST /otp/verify-otp` has no guard, no `@Throttle()`, and the global `ThrottlerModule` config is — same finding as `auth.md`/`mail.md` — never actually enforced anywhere in the app. There is also no attempt-counter field on the `OTP` row and no check for one. A 6-digit code is only as strong as the guess-rate limit protecting it, and none exists: an attacker who knows a valid `identifier`+`type` pair can submit unlimited guesses against a live 10-minute window. (Bcrypt's hashing cost is irrelevant here — no hash computation happens client-side, so it doesn't slow an online guesser at all; it only matters for the separate, lower-priority scenario of an attacker who has already compromised the database.)
2. **The OTP email is never actually sent** — see [`mail.md`](./mail.md#known-gaps--recommended-hardening) for the full detail. The consequence specific to this module: `generateAndSendOtp` still returns `{ success: true, message: 'OTP sent to ${identifier}' }`, a materially misleading response given nothing was dispatched. Today, the plaintext code's only real distribution channel is a debug log line (next finding).
3. **The plaintext OTP is logged unconditionally, and the app's own log-redaction system doesn't catch it.** `logger.debug(\`[DEV MODE] OTP for ${identifier}: ${plainOtp}\`)` has no `NODE_ENV` gate despite its label, and interpolates the code directly into the message *string* rather than passing it as structured metadata. The shared logger's redaction utility (`DEFAULT_REDACTED_KEYS`, which does include `'otp'`) only redacts object *keys* — it never inspects message strings, so this specific line bypasses the exact protection the app built for this exact class of leak. Whether this becomes a real exposure depends on deployment config: if `LOG_FILE_ENABLED=true` and `LOG_LEVEL=debug` in any environment (a plausible misconfiguration — e.g. dev-level logging left on somewhere prod-adjacent), live 6-digit codes get written to rotated log files on disk in plaintext.
4. **No cleanup job for used/expired OTP rows.** `OtpRepository.cleanUpOldOtps()` exists, has a doc comment explicitly saying "run this periodically (e.g., once a day) via a Cron job," and is never called from anywhere — no `@nestjs/schedule` `ScheduleModule`/`@Cron` is registered in the app at all. The `otps` table grows without bound.
5. **No invalidation of a prior outstanding OTP when a new one is generated.** `generateAndSendOtp` always `INSERT`s; it never marks an earlier unexpired, unused row for the same `identifier`+`type` as used first. Verification still works correctly (it picks the newest row via `orderBy: createdAt desc`), but multiple valid rows can silently coexist until they individually expire or `cleanUpOldOtps` (never run) sweeps them.
6. **No resend endpoint exists at all.** `generateAndSendOtp` has zero HTTP entry point of its own — it is only ever triggered as a side effect of `POST /user/create-user`. A user who loses their OTP (moot today since none is emailed, but relevant once mail is reconnected) has no way to request a fresh one without re-registering.
7. **`VerifyOtpResponseDto.data` (`{ access_token, refresh_token }`) is declared and Swagger-documented but never populated** by either construction site in `otp.service.ts`. This strongly implies an intended "auto-login immediately after verifying signup" feature that was scaffolded into the response contract but never implemented — a client cannot currently rely on OTP verification to also authenticate the user.
8. **`@HttpCode(HttpStatus.FOUND)` (302) on the verify route** — the only `302` anywhere in the codebase; every other route uses `OK`/`CREATED`/`NO_CONTENT`. Almost certainly a copy-paste mistake for `HttpStatus.OK`; a 302 on a JSON-envelope POST response with no `Location` header will confuse HTTP-aware clients (redirect-following fetch/XHR behavior differs from a normal 2xx).
9. **A dead, unreachable `NotFoundException` guard sits next to the one that actually fires.** `verifyOtp`'s own `if (!user) throw new NotFoundException('No account found with identifier: ...')` can never execute — `UserService.getUserByEmail` already throws its own, differently-worded `NotFoundException('User with email ... not found.')` first. Two message strings exist for the same failure mode; only one is ever seen by a client.
10. **`generateAndSendOtp`'s catch-all swallows every internal error into one generic `500`** (`'Failed to process OTP request'`) — a Prisma constraint violation, a hashing failure, anything, all look identical to the caller. Since this runs inside `registerUser`'s own transaction, the failure does correctly roll back registration, but debugging which step actually failed requires reading server logs, not the response.
11. **Dead code accumulation inside the module**: a byte-for-byte duplicate, fully commented-out copy of `verifyOtp` (~46 lines, referencing an unimported `HashUtil.compare` from before `HashService` existed) at the bottom of `otp.service.ts`; a commented-out `OTP_SELECT` projection constant in `otp.repository.ts` that nothing uses (every query returns the full row, hashed `code` included, with no projection); and `entities/otp.entity.ts` (`OtpEntity`, with an `isExpired` getter) that is never imported or instantiated anywhere in the codebase.
12. **Both test specs are default, unmodified Nest CLI stubs**, and `otp.controller.spec.ts` is arguably broken as written — it instantiates a testing module with `controllers: [OtpController]` and no `OtpService` mock, which `OtpController`'s constructor requires. Neither spec exercises `generateAndSendOtp` or `verifyOtp` in any way.
13. **`VerifyOtpDto.identifier` is hard-`@IsEmail()`-validated**, despite its own Swagger description ("email address or phone number") and the underlying schema/enum (`PHONE_CHANGE`) implying phone-based OTP is a supported concept. A phone identifier would fail validation before ever reaching the service.

---

### API End Point & Business Logic

Served by `OtpController` → `OtpService` → `OtpRepository` (+ `UserService` for account lookup/activation, `HashService` for hash/compare). One route, prefixed `/api/v1/otp`.

#### Endpoint Overview

| Method | Path              | Access | Purpose                                                        |
| :------- | :------------------ | :------- | :------------------------------------------------------------------- |
| `POST`  | `/otp/verify-otp`   | Public | [Verify a submitted code and, for a signup OTP, activate the account](#verify-otp) |

There is no generation/resend route — `generateAndSendOtp` is invoked only internally, by `UserService.registerUser` (documented in [`user.md`](./user.md#register-a-user)).

---

#### Response Shapes & Select Projections

| DTO                        | Fed to                          | Contains                                                                                                              |
| :---------------------------- | :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `VerifyOtpDto`                | `POST /otp/verify-otp` body           | `identifier` (`@IsEmail`), `code` (`@Length(6,6)`, `@Matches(/^\d+$/)`), `type` (`@IsEnum(OTPType)`).                    |
| `VerifyOtpResponseDto`        | `generateAndSendOtp` and `verifyOtp` returns | `success` (bool), `userId?` (number — only meaningfully set by `verifyOtp`), `message` (string), `data?` (`{ access_token, refresh_token }` — **declared, never populated**, see [Known Gaps](#known-gaps--recommended-hardening)). |

No `select` projection exists anywhere in `OtpRepository` — every query returns the full `OTP` row, including the bcrypt-hashed `code` column, straight from Prisma with no field filtering (the one attempt at a projection, `OTP_SELECT`, is dead/commented-out code).

---

#### Verify OTP

**`POST /api/v1/otp/verify-otp`**

**Purpose**: Validate a submitted 6-digit code against the newest outstanding OTP for that identifier+type; for `SIGNUP`, also activates the account.

**Access**: Public — must be reachable before the account is verified/active, so no guard is applied (correctly, unlike some of this codebase's other unguarded routes documented in `mail.md`).

| Layer      | What happens                                                                                                                  |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------- |
| Controller | `verify(dto)` — no other logic, returns the service result directly.                                                          |
| Service    | `verifyOtp(dto)` — resolve account, find OTP, compare hash, burn + type-specific side effect inside a transaction.             |
| Repository | `findLatestValidOtp(identifier, type)` → (inside `withTransaction`) `markAsUsed(id, tx)`.                                       |

**Business logic — in order:**

1. **Resolve the account** — `userService.getUserByEmail(identifier)`. No match → `404 NotFoundException('User with email ${email} not found.')` (thrown inside `UserService`; a second, differently-worded check in `verifyOtp` itself is dead code that can never fire — see [Known Gaps](#known-gaps--recommended-hardening)).
2. **Find the OTP** — `findLatestValidOtp(identifier, type)`: `where: { identifier, type, isUsed: false, expiresAt: { gt: now } }`, newest first. No match (never existed, already used, or expired — all three collapse to the same lookup miss) → `400 BadRequestException('OTP has expired or does not exist. Please request a new one.')`.
3. **Compare the code** — `hashService.compare(dto.code, otpRecord.code)` (bcrypt). Mismatch → `400 BadRequestException('Invalid OTP code.')`. No attempt counter, no lockout — see [Known Gaps](#known-gaps--recommended-hardening) #1.
4. **On match, inside one transaction**:
   - `markAsUsed(otpRecord.id, tx)` — sets `isUsed: true`. Runs first.
   - **Only if `type === OTPType.SIGNUP`**: `userService.activateUser(user.id, tx)` — flips `User.status` to `ACTIVE` and `UserSecurity.isEmailVerified` to `true` (documented in `user.md`). For any other type, nothing further happens — the OTP is burned with no effect, since no other type has a wired side effect (see [`OTPType` Reachability](#otptype-reachability)).
5. **Response** — `{ success: true, userId: otpRecord.userId ?? undefined, message: 'OTP verified successfully' }`. `userId` is read off the **OTP row**, not the resolved `user` object — functionally identical today (the only live path always populated it at generation time), but would silently be `undefined` for a hypothetical future guest-flow OTP. `data` (tokens) is never set — verifying an OTP does **not** log the user in; the client must separately call `POST /auth/login` (documented in `auth.md`).

**Response shape**: `VerifyOtpResponseDto`, envelope `{ statusCode: 302, success: true, message: 'OTP verified successfully', data: { success, userId, message } }` — note the outer HTTP status is `302 Found` per the route's `@HttpCode`, not `200`; see [Known Gaps](#known-gaps--recommended-hardening) #8.

| Status | Cause                                                                                                                    |
| :----- | :------------------------------------------------------------------------------------------------------------------------- |
| `302`  | Verified successfully. (Almost certainly meant to be `200` — see [Known Gaps](#known-gaps--recommended-hardening).)         |
| `400`  | DTO validation failed (`code` not exactly 6 digits, `identifier` not a valid email, `type` not a valid `OTPType`); **or** no matching unused/unexpired OTP found; **or** the submitted code doesn't match the stored hash. |
| `404`  | No user exists with that `identifier`.                                                                                     |

---

### Module Coupling

| Module            | Relationship                                                                                                                                                                                                          |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UserModule`         | Mutual `forwardRef` — `OtpModule` imports `forwardRef(() => UserModule)`, `UserModule` imports `forwardRef(() => OtpModule)`. `OtpService` calls `userService.getUserByEmail` (resolve) and `userService.activateUser` (SIGNUP side effect); `UserService.registerUser` calls `otpService.generateAndSendOtp` inside its own registration transaction. See `user.md`'s [Auth & OTP Coupling](./user.md#auth--otp-coupling) for the reverse view. |
| `MailModule`         | Imported live (`OtpModule`'s `imports` array) but **entirely unused today** — the only call that would exercise it (`MailService.sendOtpEmail`) is commented out in `OtpService`. See [`mail.md`](./mail.md). |
| `HashModule`         | Provides `HashService` for both hashing a newly generated code and comparing a submitted one against the stored hash — the same bcrypt wrapper `UserService`/`AuthService` use for passwords.                        |
| `AuthModule`         | **No relationship.** `AuthService` never references `OtpService`, and OTP verification never issues tokens (`VerifyOtpResponseDto.data` is dead — see [Known Gaps](#known-gaps--recommended-hardening)). A verified user must still call `/auth/login` separately, documented in [`auth.md`](./auth.md). |
