-- Store duration of seller leg after transfer (from telephony status callbacks)
ALTER TABLE "call_metric" ADD COLUMN IF NOT EXISTS "post_transfer_duration_sec" INTEGER;
