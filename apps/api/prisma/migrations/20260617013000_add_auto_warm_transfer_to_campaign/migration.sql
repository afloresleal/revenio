ALTER TABLE "ghl_campaign"
ADD COLUMN IF NOT EXISTS "auto_warm_transfer_enabled" BOOLEAN;
