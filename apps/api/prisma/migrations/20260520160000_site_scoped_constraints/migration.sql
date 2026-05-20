-- Multi-account, Phase 4: shift global uniqueness onto per-site uniqueness and
-- tighten siteId to NOT NULL. Safe because Phase 1 backfilled every tenanted
-- row.

-- 1. Drop the global unique indexes that block per-site reuse.
DROP INDEX "Plant_qrCode_key";
DROP INDEX "LocationShape_qrCode_key";
DROP INDEX "Tag_kind_name_key";

-- 2. Add per-site uniqueness. Postgres treats NULL as distinct in unique
-- indexes by default, so LocationShape rows without a qrCode don't collide.
CREATE UNIQUE INDEX "Plant_siteId_qrCode_key" ON "Plant"("siteId", "qrCode");
CREATE UNIQUE INDEX "LocationShape_siteId_qrCode_key" ON "LocationShape"("siteId", "qrCode");
CREATE UNIQUE INDEX "Tag_siteId_kind_name_key" ON "Tag"("siteId", "kind", "name");

-- 3. siteId NOT NULL on every tenanted table.
ALTER TABLE "Plant" ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "Action" ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "LocationShape" ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "Tag" ALTER COLUMN "siteId" SET NOT NULL;
