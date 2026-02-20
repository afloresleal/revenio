-- Add transcript field to CallMetric for end-of-call-report data
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "transcript" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "recording_url" TEXT;
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "cost" DECIMAL(10, 4);
