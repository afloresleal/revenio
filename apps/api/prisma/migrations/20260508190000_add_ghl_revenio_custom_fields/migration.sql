ALTER TABLE "ghl_campaign"
  ADD COLUMN IF NOT EXISTS "ghl_outcome_field_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ghl_answered_agent_field_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ghl_first_agent_field_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ghl_recording_url_field_id" TEXT;
