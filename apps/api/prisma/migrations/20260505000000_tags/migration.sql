-- Replace single-value PlantType with multi-value Tag (name + color).
-- Existing PlantType rows are migrated into Tag with a default color, and
-- existing Plant.typeId values become rows in the implicit join table.

-- CreateTable: Tag
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateTable: implicit M2M join PlantToTag
CREATE TABLE "_PlantToTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_PlantToTag_AB_unique" ON "_PlantToTag"("A", "B");
CREATE INDEX "_PlantToTag_B_index" ON "_PlantToTag"("B");

ALTER TABLE "_PlantToTag"
    ADD CONSTRAINT "_PlantToTag_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_PlantToTag"
    ADD CONSTRAINT "_PlantToTag_B_fkey"
    FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: copy PlantType -> Tag (assign default green), then plant
-- assignments from Plant.typeId -> _PlantToTag.
INSERT INTO "Tag" ("id", "name", "color", "createdAt")
SELECT "id", "name", '#16a34a', "createdAt"
FROM "PlantType";

INSERT INTO "_PlantToTag" ("A", "B")
SELECT "id", "typeId"
FROM "Plant"
WHERE "typeId" IS NOT NULL;

-- Drop the old typeId column / FK / index, then PlantType itself.
ALTER TABLE "Plant" DROP CONSTRAINT "Plant_typeId_fkey";
DROP INDEX "Plant_typeId_idx";
ALTER TABLE "Plant" DROP COLUMN "typeId";

DROP TABLE "PlantType";
