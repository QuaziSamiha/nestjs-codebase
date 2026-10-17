# Mail Module

Outbound transactional email — in principle. Like `auth.md`, this module owns no Prisma schema; unlike `auth.md`, it isn't even fully wired into the flow it was built for: the OTP signup email it exists to send is currently **never called** (the call site is commented out in `OtpService`), leaving `MailModule`'s only live, reachable behavior as a single unguarded manual test route. This doc documents the module as it actually behaves today, not as its naming/structure implies it behaves — the gap between the two is the most important thing to understand about this module.

Module source: `src/modules/mail/` (`mail.controller.ts`, `mail.service.ts`, `mail.module.ts`, `dto/email.dto.ts`, `templates/otp.hbs`).

> **Scope note:** `OtpService`/`OTP` are documented in [`user.md`](./user.md) — they appear here only as Mail's intended (currently disconnected) caller. `User`/registration flow is also documented in `user.md`. This doc covers only what lives in `src/modules/mail/` plus the env/config surface it reads.

---

### Architecture Overview

#### Delivery Pipeline

| Stage           | Implementation                                                                                                    |
| :---------------- | :---------------------------------------------------------------------------------------------------------------- |
| **Library**       | `@nestjs-modules/mailer` (`^2.3.4`) wrapping `nodemailer` (`^8.0.5`) — not a raw transporter instantiated by hand, not a third-party API (Resend/SendGrid/etc.). |
| **Registration**  | `MailerModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory })` in `mail.module.ts` — the transport is built once at module init, not per-send. |
| **Template engine** | `HandlebarsAdapter` (`@nestjs-modules/mailer/adapters/handlebars.adapter`), `template.dir: path.join(__dirname, 'templates')`, `template.options.strict: true`. |
| **Templates**     | Exactly one: `templates/otp.hbs`. No layouts, no partials, no other template files.                                |
| **Dispatch**       | Synchronous inline `await mailerService.sendMail(...)` inside a `try/catch`. No queue (no BullMQ/Bull), no retry logic, no explicit send timeout. |

#### Transport Configuration (`mail.module.ts` factory)

| Transport option              | Source                                                             | Note                                                                                                     |
| :------------------------------- | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `transport.host`                  | `config.get('MAIL_HOST')`                                          |                                                                                                                 |
| `transport.port`                  | `Number(config.get('MAIL_PORT')) || 587`                            | **Hardcoded fallback `587`** if unset or non-numeric.                                                          |
| `transport.secure`                | **Hardcoded `false`**                                               | Comment says "STARTTLS on 587" — not derived from the `MAIL_ENCRYPTION` env var, which exists in every `.env*` file but is never read by any code. See [Known Gaps](#known-gaps--recommended-hardening). |
| `transport.auth.user`             | `config.get('MAIL_USERNAME')`                                       |                                                                                                                 |
| `transport.auth.pass`             | `config.get('MAIL_PASSWORD')`                                       |                                                                                                                 |
| `transport.tls.rejectUnauthorized`| **Hardcoded `false`**                                               | Comment: "Helps with local dev/testing" — but unconditional across **every** environment, including production. See [Known Gaps](#known-gaps--recommended-hardening). |
| `defaults.from`                    | `` `"${config.get('APP_NAME')}" <${config.get('MAIL_FROM')}>` ``     | Display name comes from `APP_NAME`; the address from `MAIL_FROM`.                                              |

#### Template Dictionary — `otp.hbs`

**Purpose:** the OTP email body, shared by every `OTPType`. Plain HTML with an inline `<style>` block — no `{{#if}}`/`{{#each}}` blocks, no partials.

| Placeholder    | Supplied by                          | Notes                                                                                                    |
| :--------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `{{otpCode}}`    | `MailService.sendOtpEmail`             | The 6-digit code.                                                                                              |
| `{{title}}` / `{{intro}}` / `{{unsolicited}}` | The per-`OTPType` copy block in `mail.service.ts` | Different wording per OTP type, so a reset email never reads like a signup email.                               |
| `{{appName}}` / `{{year}}` | `APP_NAME` env var / current year | Header and footer branding.                                                                                   |

Notes on the rest of the template:

- Header/logo text and footer come from `{{appName}}` (`APP_NAME`), the footer year from `{{year}}`; `{{title}}`, `{{intro}}` and `{{unsolicited}}` come from the per-`OTPType` copy block in `mail.service.ts`.
- Validity claim: *"This code is valid for **10 minutes**."* — happens to agree with `OtpService`'s actual `expiresAt` (10 minutes, per `user.md`), but there is no `{{expiryMinutes}}` variable — it's a magic number duplicated independently in two files that would silently drift if the OTP TTL were ever changed in code without also editing this template.

**No live HTML-injection vector today**: `otpCode` is a server-generated 6-digit numeric string (`crypto.randomInt(100000, 999999)`, per `OtpService`), never user-supplied text; and the one live caller of `sendOtpEmail` (`MailController`) hardcodes its own `otpCode` argument rather than interpolating the caller-supplied `email` into the template context at all.

---

### Config & Environment

Unlike `auth`'s `auth.env.ts` → `registerAs('auth', ...)` pattern, **Mail owns no dedicated config file**. Its env vars are folded into the root `appEnvSchema` in `src/config/env.validation.ts`, and — critically — that schema validates different variable names than the code actually reads.

| Zod schema field (`env.validation.ts`) | Validation      | What `mail.module.ts` actually reads | Match? |
| :----------------------------------------- | :------------------ | :---------------------------------------- | :------- |
| `MAIL_HOST`                                 | `z.string().optional()` | `MAIL_HOST`                               | ✅        |
| `MAIL_PORT`                                 | `z.coerce.number().optional()` | `MAIL_PORT`                        | ✅        |
| `MAIL_USER`                                 | `z.string().optional()` | `MAIL_USERNAME`                           | ❌ **mismatch** |
| `MAIL_PASS`                                 | `z.string().optional()` | `MAIL_PASSWORD`                           | ❌ **mismatch** |
| `MAIL_FROM`                                 | `z.string().optional()` | `MAIL_FROM`                               | ✅        |
| *(not in schema)*                            | —                    | `MAIL_ENCRYPTION` — **defined in every `.env*` file, never read by any code.** | dead var |
| *(not in schema)*                            | —                    | `MAIL_DRIVER` — same, dead.                | dead var |

Every field above is `.optional()` with **no `.default()`** — unlike `auth.env.ts`'s required-secret-or-boot-fails contract, the app boots successfully even with zero SMTP configuration; `MailerModule.forRootAsync`'s factory would simply build a transport with `host: undefined`, `auth.user: undefined`, `auth.pass: undefined`, and any send attempt fails at runtime instead of at boot. See [Known Gaps](#known-gaps--recommended-hardening).

**Per-environment `.env*` state** (do not treat any of this as current-truth after a config change — verify against the live files before relying on it):
- `.env`, `.env.development.local`, `.env.office` — all point at the same shared external SMTP relay, fully populated (`MAIL_DRIVER=smtp`, `MAIL_HOST`, `MAIL_PORT=587`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_ENCRYPTION=tls`, `MAIL_FROM`).
- `.env.development` — the whole mail block is commented out; plain local dev is expected to run with no SMTP configured at all.
- `.env.production` — every mail var is commented out with a `REPLACE_WITH_...` placeholder value (using a non-standard `//*` comment prefix rather than `#`), except `MAIL_ENCRYPTION`/`MAIL_DRIVER` which are left active. Production, as checked in, is configured to boot with **no real SMTP host or credentials** — and because there's no fail-fast validation, that failure would only surface the first time something actually tries to send.

---

### Known Gaps / Recommended Hardening

Ranked roughly by how much it matters before this module can be trusted to deliver mail in production.

1. **The OTP email this module exists to send is never actually sent.** `OtpService.generateAndSendOtp` — the only place in the app that would call `MailService` — has its `MailService` injection, the `sendOtpEmail(...)` call, and the surrounding dev/prod branching **entirely commented out** (`otp.service.ts` lines ~10, 19, 27–28, 66–76). The method still returns a success DTO whose message reads `` `OTP sent to ${identifier}` `` — **a materially misleading response**: registration succeeds, the API claims an OTP was sent, and no email is dispatched. Anyone relying on this doc's or the API's word that verification email works needs to know it currently does not. Cross-reference: `user.md`'s registration walkthrough and `auth.md`'s Known Gaps both describe the *intended* flow; this is the concrete reason the intended flow doesn't run end-to-end today.
2. **`POST /email/test` has zero auth guards** — no `JwtAuthGuard`, no `RolesGuard`, no `@Roles()`, not even a `@Public()` marker acknowledging the intent. Any caller who can reach the API can trigger an SMTP send to an arbitrary attacker-supplied recipient, with no application-level rate limiting (the global `ThrottlerModule` config exists but — per `auth.md`'s Known Gaps #4 — no `ThrottlerGuard` is ever actually applied anywhere in the codebase). This is a live spam-relay/abuse vector sitting on a route named "test."
3. **Live SMTP credentials are committed in plaintext** across `.env`, `.env.development.local`, and `.env.office` (username + password for a real external mail relay). Independent of code-level hardening, this is a secrets-hygiene issue worth rotating and moving to a secret manager.
4. **The Zod-validated env var names don't match what the code reads.** The root schema validates `MAIL_USER`/`MAIL_PASS`; the transport factory reads `MAIL_USERNAME`/`MAIL_PASSWORD`. The result: the two variables that actually authenticate the SMTP connection have **no validation at all** (a typo or missing value in production surfaces only as a runtime `EAUTH` error, caught and silently logged — see #6 — not a boot-time failure), while the validated `MAIL_USER`/`MAIL_PASS` fields validate against variables that don't exist in any real `.env*` file.
5. **`MAIL_ENCRYPTION` and `MAIL_DRIVER` are dead env vars.** Both are defined in every `.env*` file (`MAIL_ENCRYPTION=tls`), but no code anywhere reads either — `transport.secure` is hardcoded `false` regardless. A developer changing `MAIL_ENCRYPTION` expecting it to affect the connection would see no effect.
6. **A send failure is caught, logged, and swallowed — never rethrown.** `MailService.sendOtpEmail` returns `false` on any error (with a special-cased log message for SMTP `EAUTH` failures) rather than propagating an exception. Only `MailController`'s one route happens to check the boolean and convert `false` into a `500`; any *future* caller that doesn't check the return value (the way the commented-out `OtpService` code was clearly meant to) would silently proceed as if the email had sent.
7. **`tls.rejectUnauthorized: false` is unconditional across all environments**, including production — there's no `NODE_ENV`-gated branch the way the comment ("Helps with local dev/testing") implies there should be. This weakens TLS certificate validation on the production SMTP connection too.
8. **No retry logic and no queue.** Dispatch is a single synchronous `await` inside the request/call path — a slow or hanging SMTP connection blocks whatever triggered it for as long as nodemailer takes to fail, with no explicit timeout configured on the transport.
9. **No delivery/bounce tracking.** Nodemailer's `sendMail` resolves with a `SentMessageInfo` object (accepted/rejected recipients, message-id, etc.) that `sendOtpEmail` discards entirely, returning only a bare `boolean`.
10. **Branding is a single env var.** `APP_NAME` drives the `from` display name (`mail.module.ts`), the subjects/intros (`mail.service.ts`), and the header/footer in `otp.hbs`. Colors and layout are still baked into the template — restyle `otp.hbs` per project.
11. **Stale code comment**: `sendOtpEmail`'s inline comment says the context "replaces `{{otp}}` in the Handlebars file," but the real placeholder is `{{otpCode}}`. Harmless (the property name used does match the template) but misleading to a future reader.
12. **No meaningful test coverage.** Both `mail.controller.spec.ts` and `mail.service.spec.ts` are unmodified default Nest CLI stubs — neither supplies a mock for the class's own constructor dependency (`MailService`'s spec provides no `MailerService` mock; `MailController`'s spec provides no `MailService` mock), and each asserts only `toBeDefined()`. No test exercises a successful send, the `EAUTH` branch, the generic-failure branch, or the controller's `InternalServerErrorException` path.

---

### API End Point & Business Logic

Served by `MailController` → `MailService` → `@nestjs-modules/mailer`'s `MailerService`. One route, prefixed `/api/v1/email` (module-local `@Controller('email')`, not `/mail`).

#### Endpoint Overview

| Method | Path          | Access | Purpose                                                      |
| :------- | :-------------- | :------- | :----------------------------------------------------------------- |
| `POST`  | `/email/test`   | **None — unguarded** | [Manually smoke-test SMTP connectivity by sending a hardcoded OTP-styled email](#send-test-email) |

There is no other Mail route — no generic "send email" endpoint, no "resend OTP" endpoint (grep confirms no `resend` route exists anywhere in the codebase).

---

#### Response Shapes & Select Projections

| Shape                     | Fed to                       | Contains                                                                                     |
| :---------------------------- | :-------------------------------- | :------------------------------------------------------------------------------------------------ |
| `EmailDto`                    | `POST /email/test` body            | `email` (`@IsEmail`, `@IsNotEmpty`) — the only field. No `otpCode`, no template-name override, no CC/BCC. |
| Route response body            | `POST /email/test` response         | `{ email: body.email }` — echoes the recipient back; does **not** return the OTP code, a message-id, or nodemailer's delivery receipt. |

---

#### Send Test Email

**`POST /api/v1/email/test`**

**Purpose**: Manual SMTP-connectivity smoke test — sends the real OTP email template to an arbitrary address with a hardcoded fake code. Not tied to any real `OTP` record.

**Access**: None. No guard of any kind.

| Layer      | What happens                                                                                                 |
| :--------- | :------------------------------------------------------------------------------------------------------------ |
| Controller | `sendTestEmail(body)` — calls the service with a hardcoded code, checks the boolean result, maps failure to an HTTP exception. |
| Service    | `sendOtpEmail(email, otpCode)` — renders `otp.hbs` via `MailerService.sendMail`, catches and swallows any error. |

**Business logic — in order:**

1. `EmailDto` validates the body has a well-formed `email`.
2. Controller calls `mailService.sendOtpEmail(body.email, '222222')` — **`'222222'` is a hardcoded literal**, not a generated or persisted OTP; this route creates no `OTP` row and is unrelated to the real signup-verification flow beyond sharing the same template/service method.
3. Inside the service: `mailerService.sendMail({ to: email, subject: `Verify Your Email - ${appName}`, template: './otp', context: { otpCode } })`, wrapped in `try/catch`.
   - Success → returns `true`.
   - Failure → logs via `Logger.error` (a distinct message branch when `error.code === 'EAUTH'`, naming `MAIL_USERNAME`/`MAIL_PASSWORD` as the likely cause) and returns `false`. **No exception escapes the service.**
4. Controller: `sendOtpEmail` returned `false` → throws `500 InternalServerErrorException('Failed to send test email')`. Returned `true` → responds `{ email: body.email }`.

**Response shape**: `{ email: string }`, envelope `{ statusCode: 200, success: true, message: 'Test email sent successfully', data: { email } }`.

| Status | Cause                                                                 |
| :----- | :------------------------------------------------------------------------ |
| `200`  | Send succeeded (per nodemailer/the SMTP server accepting the message — not proof of actual inbox delivery). |
| `400`  | `email` missing or not a valid email address.                             |
| `500`  | SMTP send failed for any reason (auth failure, connection refused, misconfigured host, etc. — all collapse to the same generic message; see [Known Gaps](#known-gaps--recommended-hardening) #6). |

---

### Module Coupling

| Module            | Relationship                                                                                                                                                                                                       |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OtpModule`          | Imports `MailModule` directly (no `forwardRef`) and is the module `MailService` was clearly built for — but the actual injection/call site inside `OtpService` is fully commented out today. See [Known Gaps](#known-gaps--recommended-hardening) #1. |
| `AppModule`          | Also imports `MailModule` directly at the root, redundant with `OtpModule`'s own import — `MailModule` carries no `@Global()` decorator, so this doesn't change what can inject `MailService` elsewhere; `AppController`/`AppService` don't use it. |
| `UserModule`         | **No direct relationship.** `UserService` reaches OTP functionality only through `OtpService` (via `forwardRef`, per `user.md`) — it never imports `MailModule` or injects `MailService` itself, and there is no welcome-email-on-registration flow. |
| `AuthModule`         | **No relationship at all.** No password-reset flow exists (per `auth.md`'s Known Gaps), so there is no login/auth-adjacent code path that touches Mail either. |
