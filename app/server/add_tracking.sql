-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "courierName" TEXT,
ADD COLUMN     "expectedDelivery" TEXT,
ADD COLUMN     "trackingLocation" TEXT,
ADD COLUMN     "trackingNumber" TEXT,
ADD COLUMN     "trackingStatus" TEXT;

