ALTER TABLE "ghl_campaign"
  ADD COLUMN IF NOT EXISTS "ghl_location_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ghl_api_key" TEXT,
  ADD COLUMN IF NOT EXISTS "ghl_pipeline_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ghl_stage_id" TEXT;
