-- Persist Twilio transfer leg telemetry and artifacts.
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "twilio_parent_call_sid" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "twilio_transfer_call_sid" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "transfer_status" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "transfer_transcript" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "full_transcript" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "transfer_recording_url" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "transfer_recording_duration_sec" INTEGER;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "recordings_json" JSONB;

CREATE TABLE IF NOT EXISTS "twilio_call_link" (
  "id" TEXT NOT NULL,
  "parent_call_sid" TEXT NOT NULL,
  "child_call_sid" TEXT,
  "vapi_call_id" TEXT NOT NULL,
  "lead_id" TEXT,
  "attempt_id" TEXT,
  "child_status" TEXT,
  "last_callback_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "twilio_call_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "twilio_call_link_parent_call_sid_key" ON "twilio_call_link"("parent_call_sid");
CREATE INDEX IF NOT EXISTS "twilio_call_link_vapi_call_id_idx" ON "twilio_call_link"("vapi_call_id");
CREATE INDEX IF NOT EXISTS "twilio_call_link_lead_id_idx" ON "twilio_call_link"("lead_id");
CREATE INDEX IF NOT EXISTS "twilio_call_link_attempt_id_idx" ON "twilio_call_link"("attempt_id");
CREATE INDEX IF NOT EXISTS "twilio_call_link_child_call_sid_idx" ON "twilio_call_link"("child_call_sid");
