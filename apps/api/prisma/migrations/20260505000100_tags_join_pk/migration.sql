-- Prisma represents implicit many-to-many join tables with a primary key
-- on (A, B) rather than a unique index. This brings _PlantToTag in line.

ALTER TABLE "_PlantToTag" ADD CONSTRAINT "_PlantToTag_AB_pkey" PRIMARY KEY ("A", "B");

DROP INDEX "_PlantToTag_AB_unique";
