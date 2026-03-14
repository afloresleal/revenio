-- Add transfer destination number to support seller-level call details
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "transfer_number" TEXT;
