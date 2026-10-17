# Database Seeding

`prisma/seed.ts` creates (or resets) a fixed set of baseline accounts so a fresh database has someone who can log in and administer it.

## Seed users

The accounts are defined in the `SEED_USERS` array at the top of `prisma/seed.ts`. The template ships with placeholders — **replace them with your project's real accounts before seeding anything that matters**:

| Email | Role | Password env var |
|---|---|---|
| `superadmin@example.com` | `SUPER_ADMIN` | `SEED_SUPER_ADMIN_PASSWORD` |
| `admin@example.com` | `ADMIN` | `SEED_ADMIN_PASSWORD` |
| `user@example.com` | `USER` | `SEED_USER_PASSWORD` |

Passwords are **never** hardcoded. Each `SeedUser` names an env var (`passwordEnvVar`); the value is read at runtime and hashed with bcrypt before it is written. If any required env var is missing, `resolvePasswords()` throws before touching the database — the script fails fast instead of seeding a user with an undefined password.

To add a seed user: add an entry to `SEED_USERS` and set the matching env var in the env file the script will run against (see `.env.example`).

## Running

```bash
yarn db:seed          # .env.development
yarn db:seed:local    # .env.development.local
yarn db:seed:prod     # .env.production
```

Re-running is safe. Because `email` is only unique among non-deleted rows (a partial index — see the comment on `User.email`), it can't be used as an `upsert` key, so the script does a `findFirst` by email and then updates (role, password, status) or creates.

## Fresh database order

```bash
yarn db:deploy        # apply migrations
yarn db:seed          # baseline accounts
```

## Notes

- **`dotenv-cli -e <file>` loads only the exact file passed** — it does not cascade to a `.local` override. Any secret a script needs must live in the exact file the npm script references.
- **Seeds run via `tsx`, not `ts-node`.** Prisma 7's generated client (`src/generated/prisma/`) uses `.js`-extension imports that resolve to `.ts` files; `ts-node`'s per-file CJS transpilation can't follow that, `tsx` (esbuild-based) can. Note that `tsx` does not type-check — run `yarn build` to catch type errors.
- **Rotate seeded passwords after first login**, especially the `SUPER_ADMIN` one — they are one-off bootstrap values.
