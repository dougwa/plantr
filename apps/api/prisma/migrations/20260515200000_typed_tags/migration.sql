-- Tags become typed. Custom tags carry no user-selected color anymore (color
-- and icon now derive from kind). Location-kind tags are paired 1:1 with a
-- LocationShape and replace the dedicated Plant.locationShapeId column — a
-- plant "lives" in a location iff it has that location's tag.

-- 1. TagKind enum
CREATE TYPE "TagKind" AS ENUM ('custom', 'location');

-- 2. Add kind + locationShapeId to Tag. (color is dropped below, before any
-- inserts, so location-kind rows can be backfilled without a NOT-NULL color.)
ALTER TABLE "Tag" ADD COLUMN "kind" "TagKind" NOT NULL DEFAULT 'custom';
ALTER TABLE "Tag" ADD COLUMN "locationShapeId" TEXT;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_locationShapeId_fkey"
    FOREIGN KEY ("locationShapeId") REFERENCES "LocationShape"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Tag_locationShapeId_key" ON "Tag"("locationShapeId");

-- 3. Drop the now-unused Tag.color column before the backfill so the INSERT
-- doesn't have to satisfy the NOT-NULL constraint.
ALTER TABLE "Tag" DROP COLUMN "color";

-- 4. Replace single-name uniqueness with (kind, name) so custom and location
-- tags can share a display name without colliding.
DROP INDEX "Tag_name_key";
CREATE UNIQUE INDEX "Tag_kind_name_key" ON "Tag"("kind", "name");

-- 5. Backfill location-kind tags from existing shapes. Unnamed shapes get a
-- deterministic fallback so the unique-per-kind constraint holds. Tag id is
-- derived from shape id so the join backfill in step 6 can reference it.
INSERT INTO "Tag" ("id", "name", "kind", "locationShapeId", "createdAt")
SELECT
    'loc_' || "id",
    COALESCE(NULLIF(TRIM("name"), ''), 'Location ' || RIGHT("id", 6)),
    'location'::"TagKind",
    "id",
    "createdAt"
FROM "LocationShape";

-- 6. Migrate Plant.locationShapeId assignments into the M:M tag join table.
INSERT INTO "_PlantToTag" ("A", "B")
SELECT p."id", 'loc_' || p."locationShapeId"
FROM "Plant" p
WHERE p."locationShapeId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 7. Drop Plant.locationShapeId — tags are the single source of truth.
ALTER TABLE "Plant" DROP CONSTRAINT "Plant_locationShapeId_fkey";
DROP INDEX "Plant_locationShapeId_idx";
ALTER TABLE "Plant" DROP COLUMN "locationShapeId";
