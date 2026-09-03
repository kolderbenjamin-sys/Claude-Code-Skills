#!/usr/bin/env bash
# Fetch one published article by (partial, case-insensitive) title match from Profifarmar API.
# Usage: fetch-article.sh "část titulku"
# Prints the matched article as JSON to stdout. Exits 1 with a message on stderr if not found.
set -euo pipefail

: "${AI_API_KEY:?AI_API_KEY chybí}"
QUERY="${1:?Použití: fetch-article.sh \"část titulku článku\"}"

RESPONSE=$(curl -sS -H "Authorization: Bearer ${AI_API_KEY}" \
  "https://profifarmar.cz/api/webhook.php?limit=10000")

echo "$RESPONSE" | python3 -c "
import json, sys, unicodedata

def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    return ''.join(c for c in s if not unicodedata.combining(c)).lower()

query = norm('''$QUERY''')
data = json.load(sys.stdin)
articles = data.get('data', data) if isinstance(data, dict) else data
articles = [a for a in articles if a.get('status') == 'published' and a.get('cover_image_url')]

matches = [a for a in articles if query in norm(a.get('title', ''))]
if not matches:
    print('NENALEZENO: žádný published článek s coverem neodpovídá dotazu.', file=sys.stderr)
    sys.exit(1)

matches.sort(key=lambda a: a.get('published_at') or '', reverse=True)
print(json.dumps(matches[0], ensure_ascii=False))
"
