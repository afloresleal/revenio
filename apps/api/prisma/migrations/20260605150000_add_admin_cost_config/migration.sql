-- AlterTable
ALTER TABLE "ghl_campaign"
  ADD COLUMN IF NOT EXISTS "cost_override_enabled" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "override_vapi_cost_per_minute_usd" DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS "override_twilio_cost_per_minute_usd" DECIMAL(10,4);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_cost_config" (
  "id" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "usd_to_mxn_rate" DECIMAL(10,4) NOT NULL,
  "vapi_cost_per_minute_usd" DECIMAL(10,4) NOT NULL,
  "twilio_cost_per_minute_usd" DECIMAL(10,4) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_cost_config_pkey" PRIMARY KEY ("id")
);
