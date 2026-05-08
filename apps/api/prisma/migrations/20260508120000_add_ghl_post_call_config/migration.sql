ALTER TABLE "ghl_campaign"
  ADD COLUMN IF NOT EXISTS "ghl_connected_stage_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ghl_transcript_field_id" TEXT;
