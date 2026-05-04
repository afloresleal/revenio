# Multi-Campaign MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the GHL webhook select one of four Vapi campaign configurations by `campaignId`.

**Architecture:** Add a small campaign-resolution layer inside the existing webhook module. Keep current property/location fallback intact, and only override Vapi assistant/phone number when a known `campaignId` is present.

**Tech Stack:** Node/Express, TypeScript, Zod, Prisma, Railway environment variables.

---

### Task 1: Add campaign config types and parsing

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`

- [ ] Add `campaignId` to the normalized GHL webhook schema.
- [ ] Add a `GhlCampaignConfig` type.
- [ ] Add constants for campaign codes: `IB_ES`, `IB_EN`, `NO_ES`, `NO_EN`.
- [ ] Add `parseEnvGhlCampaigns()` that reads `GHL_CAMPAIGN_<CODE>_*` variables.
- [ ] Add defaults for the four campaign slugs and property mapping.

### Task 2: Resolve campaign before creating the Vapi call

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`

- [ ] Extract `campaignId` from root payload and `customData`.
- [ ] Resolve campaign by `campaignId`.
- [ ] Use campaign's parent property for GHL API keys/stages/agent mapping.
- [ ] Use campaign `vapiAssistantId` and `vapiPhoneNumberId` when present.
- [ ] Preserve current `locationId` fallback when `campaignId` is missing or unknown.

### Task 3: Persist campaign metadata in result JSON

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`

- [ ] Store `campaignId`, `campaignKey`, and `campaignName` in lead/event/attempt result metadata.
- [ ] Return campaign details in the GHL webhook JSON response.
- [ ] Include campaign details in round-robin snapshot response for debugging.

### Task 4: Document Railway and GHL setup

**Files:**
- Modify: `docs/GHL-DEMO-HANDOFF-2026-05-03.md`
- Modify: `docs/VAPI-CONFIG.md`
- Modify: `docs/GHL-KRP-INTEGRATION.md`

- [ ] Document `campaignId` Custom Data in GHL.
- [ ] Document the four campaign slugs.
- [ ] Document Railway variable names for Vapi assistant IDs.
- [ ] Document fallback behavior if `campaignId` is missing.

### Task 5: Verify

**Files:**
- Read-only verification.

- [ ] Run TypeScript build for the API.
- [ ] Inspect the resulting request shape for a sample `campaignId`.
- [ ] Confirm no docs contradict the staging Vapi checklist.
