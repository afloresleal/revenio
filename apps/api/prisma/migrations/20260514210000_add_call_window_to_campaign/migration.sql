-- AlterTable
ALTER TABLE "ghl_campaign" ADD COLUMN "call_window_enabled" BOOLEAN,
ADD COLUMN "call_window_timezone" TEXT,
ADD COLUMN "call_window_start_hour" INTEGER,
ADD COLUMN "call_window_end_hour" INTEGER,
ADD COLUMN "call_window_weekdays" TEXT,
ADD COLUMN "call_window_apply_to_failover" BOOLEAN;
