-- AlterTable: Add currency, variants, and images to Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'PKR';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variants" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "images" TEXT;
