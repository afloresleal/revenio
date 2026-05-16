#!/bin/bash

# Helper script to check if a new DB field is properly propagated
# Usage: ./scripts/check-field-propagation.sh <fieldName> [modelName]
#
# Example: ./scripts/check-field-propagation.sh callWindowEndHour GhlCampaign

if [ -z "$1" ]; then
  echo "Usage: ./scripts/check-field-propagation.sh <fieldName> [modelName]"
  echo ""
  echo "Example: ./scripts/check-field-propagation.sh callWindowEndHour GhlCampaign"
  exit 1
fi

FIELD_NAME=$1
MODEL_NAME=${2:-""}

echo "🔍 Checking propagation of field: $FIELD_NAME"
if [ -n "$MODEL_NAME" ]; then
  echo "   Model: $MODEL_NAME"
fi
echo ""

# Change to repo root
cd "$(dirname "$0")/.."

# 1. Check Prisma schema
echo "1️⃣ Prisma Schema"
if grep -q "$FIELD_NAME" apps/api/prisma/schema.prisma; then
  echo "   ✅ Found in schema.prisma:"
  grep "$FIELD_NAME" apps/api/prisma/schema.prisma
else
  echo "   ❌ NOT found in schema.prisma"
fi
echo ""

# 2. Check TypeScript types
echo "2️⃣ TypeScript Types"
TYPE_OCCURRENCES=$(grep -r "$FIELD_NAME" apps/api/src --include="*.ts" | grep -v ".test.ts" | wc -l)
echo "   Found $TYPE_OCCURRENCES occurrences in TypeScript files:"
grep -r "$FIELD_NAME" apps/api/src --include="*.ts" | grep -v ".test.ts" | head -10
echo ""

# 3. Check for duplicate type definitions
if [ -n "$MODEL_NAME" ]; then
  echo "3️⃣ Checking for duplicate type definitions of $MODEL_NAME"
  DUPLICATE_TYPES=$(grep -r "type.*$MODEL_NAME\|interface.*$MODEL_NAME" apps/api/src --include="*.ts")
  if [ -n "$DUPLICATE_TYPES" ]; then
    TYPE_COUNT=$(echo "$DUPLICATE_TYPES" | wc -l)
    echo "   ⚠️  Found $TYPE_COUNT type definitions:"
    echo "$DUPLICATE_TYPES"
    echo ""
    echo "   🚨 WARNING: Multiple type definitions detected!"
    echo "   Make sure to update ALL of them."
  else
    echo "   ✅ No duplicate type definitions found"
  fi
  echo ""
fi

# 4. Check mapping functions
echo "4️⃣ Common Mapping Functions"
MAPPING_FUNCTIONS=("resolve" "normalize" "serialize" "build" "map")
for func in "${MAPPING_FUNCTIONS[@]}"; do
  MATCHES=$(grep -r "function.*$func.*" apps/api/src --include="*.ts" | grep -i "${MODEL_NAME,,}" | cut -d: -f1 | sort -u)
  if [ -n "$MATCHES" ]; then
    echo "   Functions containing '$func' and '${MODEL_NAME,,}':"
    for file in $MATCHES; do
      echo "      📄 $file"
      # Check if the field is used in this file
      if grep -q "$FIELD_NAME" "$file"; then
        echo "         ✅ Uses $FIELD_NAME"
      else
        echo "         ❌ Does NOT use $FIELD_NAME"
      fi
    done
  fi
done
echo ""

# 5. Check tests
echo "5️⃣ Tests"
if [ -d "apps/api/test" ]; then
  TEST_MATCHES=$(grep -r "$FIELD_NAME" apps/api/test --include="*.ts" 2>/dev/null || true)
  if [ -n "$TEST_MATCHES" ]; then
    echo "   ✅ Found in tests:"
    echo "$TEST_MATCHES"
  else
    echo "   ⚠️  NOT found in any tests"
    echo "      Consider adding a test to verify field propagation"
  fi
else
  echo "   ⚠️  Test directory not found"
fi
echo ""

# 6. Summary and recommendations
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Checklist for field: $FIELD_NAME"
echo ""
echo "Verify that $FIELD_NAME exists in:"
echo "  [ ] Prisma schema (schema.prisma)"
echo "  [ ] TypeScript type definition(s)"
echo "  [ ] All mapping functions (resolve, normalize, serialize)"
echo "  [ ] Tests (propagation test)"
echo ""
echo "If you found duplicate types, make sure to update ALL of them!"
echo ""
