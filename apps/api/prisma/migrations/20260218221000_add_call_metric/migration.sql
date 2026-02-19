-- CreateTable
CREATE TABLE "call_metric" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "assistant_id" TEXT,
    "started_at" TIMESTAMP(3),
    "transferred_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_sec" INTEGER,
    "ended_reason" TEXT,
    "outcome" TEXT,
    "sentiment" TEXT,
    "in_progress" BOOLEAN NOT NULL DEFAULT true,
    "last_event_type" TEXT,
    "last_event_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_metric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_metric_call_id_key" ON "call_metric"("call_id");

-- CreateIndex
CREATE INDEX "call_metric_started_at_idx" ON "call_metric"("started_at");

-- CreateIndex
CREATE INDEX "call_metric_outcome_idx" ON "call_metric"("outcome");

-- CreateIndex
CREATE INDEX "call_metric_sentiment_idx" ON "call_metric"("sentiment");

-- CreateIndex
CREATE INDEX "call_metric_started_at_outcome_idx" ON "call_metric"("started_at", "outcome");

-- CreateIndex
CREATE INDEX "call_metric_sentiment_outcome_idx" ON "call_metric"("sentiment", "outcome");
