# Claude AI Instructions for Revenio

> **⚠️ MANDATORY:** Any Claude AI working on this codebase MUST read this file first.

---

## 🎯 Critical Rules

### 1. Implementation Checklist is MANDATORY

**BEFORE writing any code, read:**
- `/.claude-checklist.md` - Step-by-step implementation checklist
- `docs/TESTING-AND-REVIEW-GUIDELINES.md` - Testing strategy and code review process

**This is NOT optional.** Following the checklist prevents production bugs.

### 2. Testing is Required

**No code is complete without:**
- [ ] Tests written and passing
- [ ] `./scripts/pre-commit-check.sh` passing
- [ ] Build successful
- [ ] TypeScript compiles without errors

### 3. Data Propagation Verification

**When adding fields to DB models:**
1. Search for duplicate types: `grep -r "type ModelName" apps/api/src/`
2. Update ALL type definitions (not just one)
3. Update ALL mapping functions
4. Run: `./scripts/check-field-propagation.sh <fieldName> <modelName>`
5. Write propagation test

**Example workflow:**
```bash
# Adding callWindowEndHour to GhlCampaign:
grep -r "type.*GhlCampaign" apps/api/src/  # Find duplicates
# Update all types found
# Update resolveGhlCampaign(), normalizeStoredGhlCampaign(), etc.
./scripts/check-field-propagation.sh callWindowEndHour GhlCampaign
```

### 4. External Configuration Must Be Documented

**If a feature requires Vapi/Twilio/GHL configuration:**
- [ ] Document in CHANGELOG.md with "Configuración requerida" section
- [ ] Include step-by-step instructions
- [ ] Add screenshots if UI configuration
- [ ] Tell user BEFORE marking feature as "complete"

**DO NOT say "feature is ready" if external config is needed but not documented.**

### 5. Production Impact Awareness

**This system handles production phone calls.**

A bug means:
- Lost leads
- Bad customer experience
- Revenue impact

**Therefore:**
- Test thoroughly
- Add logging for debugging
- Document external dependencies
- Never skip the checklist

---

## 📚 Key Documentation

### Start Here (New Claude Session)

1. **Read first:** `/.claude-checklist.md`
2. **Context:** `docs/ACTIVE-architecture.md`
3. **API Reference:** `docs/ACTIVE-api-reference.md`
4. **Vapi Config:** `docs/ACTIVE-vapi-config.md`

### When Implementing Features

1. **Follow:** `/.claude-checklist.md` (step-by-step)
2. **Reference:** `docs/TESTING-AND-REVIEW-GUIDELINES.md`
3. **Run scripts:** `scripts/pre-commit-check.sh` before finishing

### When Reviewing Past Bugs

**Learn from these bugs (documented):**
- `docs/IMPLEMENTED-2026-05-14-blind-transfer-fix.md` - External config not documented
- `apps/api/test/webhooks-resolve-ghl-campaign.test.ts` - Field propagation bug

**These bugs happened because the checklist wasn't followed.**

---

## 🔧 Common Tasks

### Adding a Field to a DB Model

**Process:**
```bash
# 1. Search for duplicate types
grep -r "type GhlCampaign" apps/api/src/

# 2. Create migration
# apps/api/prisma/migrations/...

# 3. Update schema.prisma

# 4. Update ALL type definitions found in step 1

# 5. Update ALL mapping functions
#    - resolveGhlCampaign()
#    - normalizeStoredGhlCampaign()
#    - serializeGhlCampaign()
#    - etc.

# 6. Write test
# apps/api/test/field-propagation.test.ts

# 7. Verify propagation
./scripts/check-field-propagation.sh fieldName ModelName

# 8. Pre-commit check
./scripts/pre-commit-check.sh

# 9. Update CHANGELOG.md
```

### Adding a Webhook/Endpoint

**Process:**
1. Implement handler
2. Write tests (mock external service)
3. Document external configuration needed
4. Test manually in staging
5. Update CHANGELOG with config steps

### Fixing a Bug

**Process:**
1. Implement fix
2. Write regression test (prevent bug from returning)
3. Run pre-commit checks
4. Update CHANGELOG
5. Document in `docs/IMPLEMENTED-*.md` if significant

---

## 🚨 Red Flags - Stop and Ask User

**Stop implementing and ask user if:**
- [ ] Found duplicate type definitions (need to update all)
- [ ] Feature requires external config (Vapi/Twilio) and I don't know exact steps
- [ ] Tests fail and I don't know why
- [ ] Build fails
- [ ] Not sure if approach is correct
- [ ] More than 5 files need modification (feature too large)

**Example response:**
```
⚠️ I found duplicate type definitions of GhlCampaignConfig in:
- apps/api/src/lib/ghl-campaigns.ts
- apps/api/src/routes/webhooks.ts

Should I:
A) Update both definitions
B) Consolidate into one and import it
C) Other approach

Which do you prefer?
```

---

## ✅ Definition of Done

**Only mark feature as "complete" when:**

- [x] Code implemented and working locally
- [x] All types updated (verified with grep)
- [x] All mapping functions updated
- [x] Tests written and passing
- [x] `./scripts/check-field-propagation.sh` pass (if DB change)
- [x] `./scripts/pre-commit-check.sh` pass
- [x] Build successful
- [x] External config documented (if needed)
- [x] CHANGELOG.md updated
- [x] User informed of what was changed

**Response template:**
```
✅ Feature implemented: [NAME]

Archivos modificados:
- apps/api/src/lib/file.ts (+20 líneas)
- apps/api/test/feature.test.ts (nuevo, 3 tests)

Verificaciones:
✅ Build exitoso
✅ Tests pasando (3/3)
✅ TypeScript sin errores
✅ Pre-commit checks pass
✅ Campo propagado correctamente (verified)
✅ CHANGELOG.md actualizado

[If external config needed]
⚠️ Configuración requerida en Vapi:
1. [Steps with screenshots if possible]

¿Quieres que probemos en staging?
```

---

## 🎓 Learn from Past Bugs

### Bug 1: callWindow Fields Not Propagated

**What happened:**
- Added 6 fields to DB
- Updated type in `ghl-campaigns.ts`
- FORGOT to copy fields in `resolveGhlCampaign()` in `webhooks.ts`
- TypeScript didn't complain (optional fields)
- Feature "worked" but campaign-specific settings were ignored

**Prevention:**
- [ ] Search for duplicate types BEFORE modifying
- [ ] Run `./scripts/check-field-propagation.sh`
- [ ] Write test verifying propagation

**Test that would have caught it:**
```typescript
test('resolveGhlCampaign propagates callWindowEndHour', async () => {
  const resolved = await resolveGhlCampaign('test');
  assert.equal(resolved.callWindowEndHour, 22); // Would have FAILED
});
```

### Bug 2: Blind-Transfer Fix Without Vapi Config

**What happened:**
- Implemented backend fix (removed blind-transfer hooks)
- Deployed to production
- FORGOT to document Vapi assistant needs transfer tool configured
- Transfers failed silently in production

**Prevention:**
- [ ] Document external config in CHANGELOG immediately
- [ ] Include screenshots/step-by-step
- [ ] Tell user BEFORE saying "done"

**Correct flow:**
```
Claude: "Implementé el fix.

⚠️ CONFIGURACIÓN REQUERIDA EN VAPI:
[Detailed steps]

¿Ya hiciste esta config?"

[WAIT for confirmation BEFORE marking as complete]
```

---

## 🤝 Working with Multiple Claude AIs

**If another Claude (Codex) worked on this repo:**
- Previous context is in conversation summaries
- Always read `.claude-checklist.md` before coding
- Follow same testing strategy
- Maintain same code quality standards

**If you're Codex reading this:**
- Hi! 👋
- Everything above applies to you too
- The checklist prevents bugs - don't skip it
- When in doubt, ask the user

---

## 📞 When to Ask for Help

**Ask user before proceeding if:**
- Unclear about requirements
- Multiple valid approaches exist
- Feature touches critical code (webhooks, transfer logic)
- External service config needed but steps unclear
- Tests pass but something feels wrong

**It's better to ask 5 times than to deploy a bug.**

---

## 🔗 Quick Links

**Must read before coding:**
- `/.claude-checklist.md` ⭐ **START HERE**
- `docs/TESTING-AND-REVIEW-GUIDELINES.md`

**Architecture & context:**
- `docs/ACTIVE-architecture.md`
- `docs/ACTIVE-vapi-config.md`
- `docs/INDEX.md` - Master doc index

**Scripts:**
- `scripts/pre-commit-check.sh` - Run before commit
- `scripts/check-field-propagation.sh` - Verify DB field propagation
- `scripts/README.md` - Scripts documentation

**Examples:**
- `apps/api/test/webhooks-resolve-ghl-campaign.test.ts` - Good test example
- `docs/IMPLEMENTED-2026-05-14-*.md` - Past implementations

---

**Last updated:** 2026-05-16
**For:** Any Claude AI working on Revenio
**Critical:** DO NOT skip the checklist
