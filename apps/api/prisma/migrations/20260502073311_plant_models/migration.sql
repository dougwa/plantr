-- CreateEnum
CREATE TYPE "ActionKind" AS ENUM ('feeding', 'watering', 'fertilizing', 'treating');

-- CreateTable
CREATE TABLE "PlantType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "name" TEXT,
    "typeId" TEXT,
    "species" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "coverPhotoId" TEXT,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "plantNetData" JSONB,
    "locationShapeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "thumbnailPath" TEXT NOT NULL,
    "coverPath" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "kind" "ActionKind" NOT NULL,
    "notes" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationShape" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "kind" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "widthMeters" DOUBLE PRECISION NOT NULL,
    "heightMeters" DOUBLE PRECISION NOT NULL,
    "rotationDegrees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationShape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlantType_name_key" ON "PlantType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Plant_qrCode_key" ON "Plant"("qrCode");

-- CreateIndex
CREATE UNIQUE INDEX "Plant_coverPhotoId_key" ON "Plant"("coverPhotoId");

-- CreateIndex
CREATE INDEX "Plant_typeId_idx" ON "Plant"("typeId");

-- CreateIndex
CREATE INDEX "Plant_locationShapeId_idx" ON "Plant"("locationShapeId");

-- CreateIndex
CREATE INDEX "Photo_plantId_idx" ON "Photo"("plantId");

-- CreateIndex
CREATE INDEX "Action_plantId_takenAt_idx" ON "Action"("plantId", "takenAt");

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "PlantType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_coverPhotoId_fkey" FOREIGN KEY ("coverPhotoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_locationShapeId_fkey" FOREIGN KEY ("locationShapeId") REFERENCES "LocationShape"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShape" ADD CONSTRAINT "LocationShape_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
