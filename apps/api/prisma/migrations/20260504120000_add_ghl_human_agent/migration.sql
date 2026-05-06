CREATE TABLE "ghl_campaign" (
  "id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "property_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'es',
  "vapi_assistant_id" TEXT NOT NULL,
  "vapi_phone_number_id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ghl_campaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ghl_campaign_campaign_id_key" ON "ghl_campaign"("campaign_id");
CREATE INDEX "ghl_campaign_property_key_idx" ON "ghl_campaign"("property_key");
CREATE INDEX "ghl_campaign_active_idx" ON "ghl_campaign"("active");

CREATE TABLE "ghl_human_agent" (
  "id" TEXT NOT NULL,
  "property_key" TEXT NOT NULL,
  "campaign_id" TEXT,
  "name" TEXT NOT NULL,
  "ghl_user_id" TEXT NOT NULL,
  "transfer_number" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ghl_human_agent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ghl_human_agent_property_key_idx" ON "ghl_human_agent"("property_key");
CREATE INDEX "ghl_human_agent_campaign_id_idx" ON "ghl_human_agent"("campaign_id");
CREATE INDEX "ghl_human_agent_property_key_priority_idx" ON "ghl_human_agent"("property_key", "priority");
CREATE UNIQUE INDEX "ghl_human_agent_property_key_campaign_id_ghl_user_id_key"
  ON "ghl_human_agent"("property_key", "campaign_id", "ghl_user_id");

CREATE TABLE "ghl_agent_pool_setting" (
  "id" TEXT NOT NULL,
  "property_key" TEXT NOT NULL,
  "campaign_id" TEXT,
  "fallback_name" TEXT,
  "fallback_transfer_number" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ghl_agent_pool_setting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ghl_agent_pool_setting_property_key_idx" ON "ghl_agent_pool_setting"("property_key");
CREATE INDEX "ghl_agent_pool_setting_campaign_id_idx" ON "ghl_agent_pool_setting"("campaign_id");
