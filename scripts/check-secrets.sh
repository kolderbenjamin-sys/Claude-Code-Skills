#!/usr/bin/env bash
# Projede skilly a hlásí hardcoded klíče. Návod: SECRETS.md
# Použití:  ./scripts/check-secrets.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

PATTERN='(api_?key|apikey|api_?secret|secret|token|password|passwd)[[:space:]]*[=:][[:space:]]*["'"'"'][A-Za-z0-9_\-]{16,}["'"'"']|Bearer[[:space:]]+[A-Za-z0-9_\-]{16,}|sk-[A-Za-z0-9_\-]{16,}|AIza[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{20,}'

hits=$(grep -rInaE "$PATTERN" .claude/skills/ 2>/dev/null \
       | grep -vE '\.xsd|\.ttf|\.woff|GetEnvironmentVariable|\$\{?[A-Z_]+\}?|<User env' || true)

if [ -n "$hits" ]; then
    echo "❌ NALEZENY možné klíče ve skillech:"
    echo "$hits"
    echo
    echo "Klíče patří do env proměnných — viz SECRETS.md"
    exit 1
fi

echo "✅ Ve skillech nejsou žádné hardcoded klíče."
