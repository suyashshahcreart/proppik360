#!/usr/bin/env bash
# Copy tour-admin public API docs to 360.proppik.cloud public_html (nginx serves /api-docs/ and root file URLs).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/docs/public-api-live"
DEST="/var/www/html/domain/360.proppik.cloud/public_html/document"
mkdir -p "$DEST"
cp -a "$SRC/tour-admin-public-api.md" "$SRC/index.html" "$SRC/PropPIK360-Tour-Admin-Public.postman_collection.json" "$DEST/"
chown -R www-data:www-data "$DEST"
echo "Synced to $DEST — https://360.proppik.cloud/api-docs/"
