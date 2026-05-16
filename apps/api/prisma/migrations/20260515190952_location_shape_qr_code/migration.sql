-- AlterTable
ALTER TABLE "LocationShape" ADD COLUMN     "qrCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LocationShape_qrCode_key" ON "LocationShape"("qrCode");
