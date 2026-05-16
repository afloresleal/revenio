#!/bin/bash

# Pre-commit validation script for Revenio
# Run this before committing code to catch common issues

set -e  # Exit on any error

echo "🔍 Running pre-commit checks..."
echo ""

# Change to repo root
cd "$(dirname "$0")/.."

# Track failures
FAILURES=0

# 1. TypeScript compilation check
echo "1️⃣ Checking TypeScript compilation..."
if npm -w apps/api exec tsc --noEmit > /dev/null 2>&1; then
  echo "   ✅ TypeScript compiles without errors"
else
  echo "   ❌ TypeScript compilation failed"
  npm -w apps/api exec tsc --noEmit
  FAILURES=$((FAILURES + 1))
fi
echo ""

# 2. Build check
echo "2️⃣ Checking build..."
if npm -w apps/api run build > /dev/null 2>&1; then
  echo "   ✅ Build successful"
else
  echo "   ❌ Build failed"
  npm -w apps/api run build
  FAILURES=$((FAILURES + 1))
fi
echo ""

# 3. Tests check (if tests exist)
echo "3️⃣ Checking tests..."
if [ -d "apps/api/test" ]; then
  TEST_FILES=$(find apps/api/test -name "*.test.ts" -o -name "*.test.js" 2>/dev/null | wc -l)
  if [ "$TEST_FILES" -gt 0 ]; then
    if npm -w apps/api test > /dev/null 2>&1; then
      echo "   ✅ All tests passing"
    else
      echo "   ❌ Tests failed"
      npm -w apps/api test
      FAILURES=$((FAILURES + 1))
    fi
  else
    echo "   ⚠️  No tests found"
  fi
else
  echo "   ⚠️  Test directory not found"
fi
echo ""

# 4. Check for common issues
echo "4️⃣ Checking for common issues..."

# Check for console.log (allow in specific files)
CONSOLE_LOGS=$(grep -r "console\.log" apps/api/src --exclude-dir=node_modules --exclude="*.test.ts" | grep -v "// OK:" | wc -l || true)
if [ "$CONSOLE_LOGS" -gt 0 ]; then
  echo "   ⚠️  Found $CONSOLE_LOGS console.log statements (consider using proper logging)"
  grep -r "console\.log" apps/api/src --exclude-dir=node_modules --exclude="*.test.ts" | grep -v "// OK:" | head -5
else
  echo "   ✅ No problematic console.log found"
fi
echo ""

# Check for hardcoded secrets
SECRETS=$(grep -rE "(sk_live|sk_test|api_key.*=.*['\"][a-zA-Z0-9]{20,})" apps/api/src --exclude-dir=node_modules || true)
if [ -n "$SECRETS" ]; then
  echo "   ❌ Possible hardcoded secrets found:"
  echo "$SECRETS"
  FAILURES=$((FAILURES + 1))
else
  echo "   ✅ No hardcoded secrets detected"
fi
echo ""

# 5. CHANGELOG check
echo "5️⃣ Checking CHANGELOG..."
if git diff --cached --name-only | grep -q "apps/api/src" || git diff --cached --name-only | grep -q "apps/admin"; then
  if git diff --cached --name-only | grep -q "CHANGELOG.md"; then
    echo "   ✅ CHANGELOG.md updated"
  else
    echo "   ⚠️  Code changed but CHANGELOG.md not updated"
    echo "      Consider adding an entry to CHANGELOG.md"
  fi
else
  echo "   ℹ️  No API/Admin code changes"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILURES -eq 0 ]; then
  echo "✅ All checks passed! Safe to commit."
  exit 0
else
  echo "❌ $FAILURES check(s) failed. Fix before committing."
  exit 1
fi
