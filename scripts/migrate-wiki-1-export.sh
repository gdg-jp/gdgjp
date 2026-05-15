#!/usr/bin/env bash
# migrate-wiki-1-export.sh  —  run while logged into the OLD Cloudflare account
#                              (gdsc.osaka@gmail.com, where gdgoc-wiki lives).
#
# Exports all resources for the gdgoc-wiki Worker so they can be re-created
# in the new gdgjp account by migrate-wiki-2-import.sh.
#
# What it does:
#   1. Verify prerequisites (wrangler, jq)
#   2. Confirm the current wrangler login and record the old account ID
#   3. Export the D1 database (schema + data) to .wiki-migration-backup/
#   4. List R2 bucket objects and save the inventory
#   5. List Vectorize index info
#   6. List queue names (queues themselves cannot be exported)
#   7. List Worker secrets (names only — values are never returned by the API)
#   8. Print next-step instructions
#
# Requirements:  wrangler >= 3.x, jq
#
# Usage:
#   cd /path/to/gdgjp
#   bash scripts/migrate-wiki-1-export.sh

set -eo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${YELLOW}=== $* ===${NC}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${REPO_ROOT}/.wiki-migration-backup"

OLD_DB_NAME="gdgoc-wiki-production-db"
OLD_R2_BUCKET="gdgoc-wiki-production-storage"
OLD_VECTORIZE_INDEX="gdgoc-wiki-production-pages"
OLD_TRANSLATION_QUEUE="gdgoc-wiki-production-translation-jobs"
OLD_INGESTION_QUEUE="gdgoc-wiki-production-ingestion-jobs"
OLD_WORKER_NAME="gdgoc-wiki"

# ─────────────────────────────────────────────────────────────────────────────
step "1. Prerequisites"
# ─────────────────────────────────────────────────────────────────────────────

for cmd in wrangler jq; do
  command -v "$cmd" &>/dev/null || die "'$cmd' is not installed."
  ok "$cmd: $(command -v "$cmd")"
done

mkdir -p "$BACKUP_DIR"
ok "Backup directory: $BACKUP_DIR"

# ─────────────────────────────────────────────────────────────────────────────
step "2. Confirm old account"
# ─────────────────────────────────────────────────────────────────────────────

info "Current wrangler identity:"
wrangler whoami 2>&1 | tee "$BACKUP_DIR/whoami-old.txt"

OLD_ACCOUNT_ID="$(wrangler whoami --json 2>/dev/null | jq -r '.account_id // empty' || true)"
if [ -z "$OLD_ACCOUNT_ID" ]; then
  warn "Could not auto-detect account ID. Run 'wrangler accounts list' to find it."
  read -rp "  Enter the OLD account ID: " OLD_ACCOUNT_ID
fi
[ -z "$OLD_ACCOUNT_ID" ] && die "Old account ID is required."

echo "$OLD_ACCOUNT_ID" > "$BACKUP_DIR/old-account-id.txt"
ok "Old account ID: $OLD_ACCOUNT_ID (saved to $BACKUP_DIR/old-account-id.txt)"

# ─────────────────────────────────────────────────────────────────────────────
step "3. Export D1 database"
# ─────────────────────────────────────────────────────────────────────────────

DUMP_FILE="${BACKUP_DIR}/${OLD_DB_NAME}.sql"
info "Exporting $OLD_DB_NAME to $DUMP_FILE..."
wrangler d1 export "$OLD_DB_NAME" \
  --remote \
  --output "$DUMP_FILE" \
  --no-schema=false \
  2>&1 | tee "${BACKUP_DIR}/${OLD_DB_NAME}-export.log" || {
  warn "Export failed — see ${BACKUP_DIR}/${OLD_DB_NAME}-export.log"
}
[ -f "$DUMP_FILE" ] && ok "Saved: $DUMP_FILE"

# ─────────────────────────────────────────────────────────────────────────────
step "4. List R2 bucket objects"
# ─────────────────────────────────────────────────────────────────────────────

info "Listing objects in r2://$OLD_R2_BUCKET ..."
wrangler r2 object list "$OLD_R2_BUCKET" \
  --json 2>/dev/null > "${BACKUP_DIR}/${OLD_R2_BUCKET}-objects.json" || {
  warn "R2 listing failed (bucket may be empty or permissions insufficient)."
}
ok "Object list: ${BACKUP_DIR}/${OLD_R2_BUCKET}-objects.json"

# ─────────────────────────────────────────────────────────────────────────────
step "5. Record Vectorize index info"
# ─────────────────────────────────────────────────────────────────────────────

info "Capturing $OLD_VECTORIZE_INDEX metadata..."
wrangler vectorize get "$OLD_VECTORIZE_INDEX" \
  --json 2>/dev/null > "${BACKUP_DIR}/${OLD_VECTORIZE_INDEX}-info.json" || {
  warn "Vectorize info fetch failed — record manually."
}
ok "Vectorize info: ${BACKUP_DIR}/${OLD_VECTORIZE_INDEX}-info.json"
warn "Vectorize indexes cannot be exported. After import, re-embed pages by"
warn "triggering the ingestion pipeline (or use a dedicated reindex script)."

# ─────────────────────────────────────────────────────────────────────────────
step "6. Record queue names"
# ─────────────────────────────────────────────────────────────────────────────

cat > "${BACKUP_DIR}/queues.txt" <<EOF
$OLD_TRANSLATION_QUEUE
$OLD_INGESTION_QUEUE
EOF
ok "Queues recorded in ${BACKUP_DIR}/queues.txt (re-created empty by import script)"

# ─────────────────────────────────────────────────────────────────────────────
step "7. List Worker secrets"
# ─────────────────────────────────────────────────────────────────────────────

SECRETS_FILE="${BACKUP_DIR}/worker-secrets.txt"
{
  echo "=== $OLD_WORKER_NAME ==="
  wrangler secret list --name "$OLD_WORKER_NAME" 2>/dev/null || echo "(none or worker not yet deployed)"
} | tee "$SECRETS_FILE"

ok "Secret names saved to $SECRETS_FILE  (values are NEVER exported — re-set them manually)"

# ─────────────────────────────────────────────────────────────────────────────
step "Done — next steps"
# ─────────────────────────────────────────────────────────────────────────────

cat <<EOF

  Export complete. Files are in: $BACKUP_DIR/

  -- Before running migrate-wiki-2-import.sh ------------------------------

  1. Switch wrangler to the NEW gdgjp account (gdgjp-developers@googlegroups.com):
       wrangler logout
       wrangler login
     Confirm you land on the correct account in the browser.

  2. Note the NEW account ID from the dashboard
     (Account Home → top-right dropdown → copy Account ID).

  3. Run:
       bash scripts/migrate-wiki-2-import.sh

EOF
