-- Remove unused ghl_transcript_field_id column
ALTER TABLE "ghl_campaign" DROP COLUMN IF EXISTS "ghl_transcript_field_id";
