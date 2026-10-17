import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from 'pg';
import { PrismaClient, UserRole } from '../src/generated/prisma/client';
const { Pool } = pkg;

const SALT_ROUNDS = 10;

interface SeedUser {
  email: string;
  role: UserRole;
  firstName: string;
  passwordEnvVar: string;
}

//* REPLACE THESE PLACEHOLDER ACCOUNTS WITH YOUR PROJECT'S OWN BEFORE SEEDING.
const SEED_USERS: SeedUser[] = [
  {
    email: 'superadmin@example.com',
    role: UserRole.SUPER_ADMIN,
    firstName: 'Super Admin',
    passwordEnvVar: 'SEED_SUPER_ADMIN_PASSWORD',
  },
  {
    email: 'admin@example.com',
    role: UserRole.ADMIN,
    firstName: 'Admin',
    passwordEnvVar: 'SEED_ADMIN_PASSWORD',
  },
  {
    email: 'user@example.com',
    role: UserRole.USER,
    firstName: 'User',
    passwordEnvVar: 'SEED_USER_PASSWORD',
  },
];

function resolvePasswords(users: SeedUser[]): Map<string, string> {
  const missing = users
    .map((u) => u.passwordEnvVar)
    .filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required password env var(s): ${missing.join(', ')}. ` +
        'Set them in the target .env.*.local file before seeding.',
    );
  }

  return new Map(
    users.map((u) => [u.email, process.env[u.passwordEnvVar] as string]),
  );
}

async function main() {
  const passwords = resolvePasswords(SEED_USERS);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  const prisma = new PrismaClient({ adapter });

  try {
    for (const user of SEED_USERS) {
      const hashedPassword = await bcrypt.hash(
        passwords.get(user.email) as string,
        SALT_ROUNDS,
      );

      // email is only unique among non-deleted rows (see User.email comment
      // in schema), so it can't be used as an upsert `where` — find first.
      const existing = await prisma.user.findFirst({
        where: { email: user.email },
      });

      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            role: user.role,
            password: hashedPassword,
            status: 'ACTIVE',
          },
        });
      } else {
        await prisma.user.create({
          data: {
            email: user.email,
            role: user.role,
            password: hashedPassword,
            status: 'ACTIVE',
            profile: { create: { firstName: user.firstName } },
            security: { create: { isEmailVerified: true } },
          },
        });
      }

      console.log(`Seeded user: ${user.email} (${user.role})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
