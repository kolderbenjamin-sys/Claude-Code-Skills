#!/usr/bin/env bash
# Signed upload of a local PNG to Cloudinary (folder SOCIALS), with an eager 1080px transform.
# Usage: cloudinary-upload.sh <local_png_path> <public_id_ascii_slug>
# Prints the eager (transformed) secure_url to stdout on success.
set -euo pipefail

: "${CLOUDINARY_CLOUD_NAME:?CLOUDINARY_CLOUD_NAME chybí}"
: "${CLOUDINARY_API_KEY:?CLOUDINARY_API_KEY chybí}"
: "${CLOUDINARY_API_SECRET:?CLOUDINARY_API_SECRET chybí}"

FILE_PATH="${1:?Použití: cloudinary-upload.sh <soubor.png> <public_id>}"
PUBLIC_ID="${2:?Použití: cloudinary-upload.sh <soubor.png> <public_id>}"
FOLDER="SOCIALS"
EAGER="w_1080,c_scale,q_100,f_png"
TIMESTAMP=$(date +%s)

# Params in the signature must be alphabetically sorted.
PARAM_STRING="eager=${EAGER}&folder=${FOLDER}&overwrite=true&public_id=${PUBLIC_ID}&timestamp=${TIMESTAMP}${CLOUDINARY_API_SECRET}"
SIGNATURE=$(printf '%s' "$PARAM_STRING" | sha1sum | awk '{print $1}')

RESPONSE=$(curl -sS -X POST "https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload" \
  -F "file=@${FILE_PATH}" \
  -F "api_key=${CLOUDINARY_API_KEY}" \
  -F "timestamp=${TIMESTAMP}" \
  -F "signature=${SIGNATURE}" \
  -F "folder=${FOLDER}" \
  -F "public_id=${PUBLIC_ID}" \
  -F "overwrite=true" \
  -F "eager=${EAGER}")

echo "$RESPONSE" | python3 -c "
import json, sys
r = json.load(sys.stdin)
if 'error' in r:
    print('ERROR: ' + r['error'].get('message', str(r)), file=sys.stderr)
    sys.exit(1)
eager = r.get('eager')
if eager:
    print(eager[0]['secure_url'])
else:
    print(r['secure_url'].replace('/image/upload/', '/image/upload/${EAGER}/'))
"
