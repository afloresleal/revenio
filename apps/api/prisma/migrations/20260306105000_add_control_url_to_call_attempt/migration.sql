-- Add control URL field used by transfer webhooks
ALTER TABLE "CallAttempt" ADD COLUMN IF NOT EXISTS "control_url" TEXT;
