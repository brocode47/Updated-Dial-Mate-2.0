-- AlterTable: Add name, logo, contact, settings to Shop
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "logo" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "contact" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "settings" TEXT;

-- AlterTable: Add assignedTo and isTakeover to Conversation
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "isTakeover" BOOLEAN NOT NULL DEFAULT false;
