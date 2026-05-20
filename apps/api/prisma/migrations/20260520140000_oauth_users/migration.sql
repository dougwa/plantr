-- Multi-account, Phase 2: relax User.passwordHash NOT NULL so OAuth-only users
-- (Apple/Google) can exist without a stored password.

ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
