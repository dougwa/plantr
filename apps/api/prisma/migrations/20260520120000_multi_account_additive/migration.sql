-- Multi-account, Phase 1: additive schema for Sites, Memberships, Invitations,
-- OAuth, and Notifications, plus nullable siteId columns on tenanted tables.
-- No existing constraints are tightened here — the data backfill runs as a
-- separate step (`pnpm --filter @plantr/api backfill-sites`). Phase 4 flips
-- siteId to NOT NULL and shifts uniqueness on Plant.qrCode / Tag / LocationShape.

-- 1. Enums
CREATE TYPE "Plan" AS ENUM ('FREE');
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'PUBLIC');
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'USER', 'VIEWER');
CREATE TYPE "OAuthProvider" AS ENUM ('APPLE', 'GOOGLE');

-- 2. User additions. email stays nullable until backfill confirms every row
-- has a value; Phase 2 will tighten to NOT NULL.
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "name" TEXT;
ALTER TABLE "User" ADD COLUMN "plan" "Plan" NOT NULL DEFAULT 'FREE';
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- 3. Site
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "ownerId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Site_ownerId_idx" ON "Site"("ownerId");
CREATE INDEX "Site_visibility_deletedAt_idx" ON "Site"("visibility", "deletedAt");
ALTER TABLE "Site" ADD CONSTRAINT "Site_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Membership — join between Sites and Users with a role.
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Membership_siteId_userId_key" ON "Membership"("siteId", "userId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Invitation — token-bearing invite (link / email / sms), 48h default expiry.
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX "Invitation_siteId_idx" ON "Invitation"("siteId");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");
CREATE INDEX "Invitation_phone_idx" ON "Invitation"("phone");
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedByUserId_fkey"
    FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. OAuthAccount — one row per (provider, providerAccountId) bound to a User.
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Notification — in-app delivery. Email/SMS/push are dispatched via stubs in
-- Phase 7 and still persist a row here.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Tenant boundary columns on existing tables. Nullable for now — backfilled
-- by scripts/backfill-sites.ts before Phase 4 enforces NOT NULL.
ALTER TABLE "Plant" ADD COLUMN "siteId" TEXT;
ALTER TABLE "Photo" ADD COLUMN "siteId" TEXT;
ALTER TABLE "Action" ADD COLUMN "siteId" TEXT;
ALTER TABLE "LocationShape" ADD COLUMN "siteId" TEXT;
ALTER TABLE "Tag" ADD COLUMN "siteId" TEXT;

CREATE INDEX "Plant_siteId_idx" ON "Plant"("siteId");
CREATE INDEX "Photo_siteId_idx" ON "Photo"("siteId");
CREATE INDEX "Action_siteId_idx" ON "Action"("siteId");
CREATE INDEX "LocationShape_siteId_idx" ON "LocationShape"("siteId");
CREATE INDEX "Tag_siteId_idx" ON "Tag"("siteId");

ALTER TABLE "Plant" ADD CONSTRAINT "Plant_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Action" ADD CONSTRAINT "Action_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationShape" ADD CONSTRAINT "LocationShape_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
