#!/usr/bin/env bash
# migrate-cf-1-export.sh  —  run while logged into the OLD Cloudflare account
#
# Exports all resources from the current account so they can be imported into
# the new account by migrate-cf-2-import.sh.
#
# What it does:
#   1. Verify prerequisites (wrangler, jq)
#   2. Confirm the current wrangler login and record the old account ID
#   3. Export D1 databases (schema + data) to .cf-migration-backup/
#   4. List R2 bucket objects and save the inventory
#   5. List Worker secrets per app so you know what to re-set later
#   6. Print next-step instructions
#
# Requirements:  wrangler >= 3.x, jq
#
# Usage:
#   cd /path/to/gdgjp
#   bash scripts/migrate-cf-1-export.sh

set -eo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${YELLOW}=== $* ===${NC}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${REPO_ROOT}/.cf-migration-backup"
R2_BUCKET="gdgjp-img-originals"

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
step "3. Export D1 databases"
# ─────────────────────────────────────────────────────────────────────────────

export_d1() {
  local DB_NAME="$1"
  local DUMP_FILE="${BACKUP_DIR}/${DB_NAME}.sql"
  info "Exporting $DB_NAME..."
  wrangler d1 export "$DB_NAME" \
    --remote \
    --output "$DUMP_FILE" \
    --no-schema=false \
    2>&1 | tee "${BACKUP_DIR}/${DB_NAME}-export.log" || {
    warn "Export of $DB_NAME failed -- see ${BACKUP_DIR}/${DB_NAME}-export.log"
    return 0
  }
  ok "Saved: $DUMP_FILE"
}

export_d1 "gdgjp-accounts-db"
export_d1 "gdgjp-tinyurl-db"
export_d1 "gdgjp-img-db"

# ─────────────────────────────────────────────────────────────────────────────
step "4. List R2 bucket objects"
# ─────────────────────────────────────────────────────────────────────────────

info "Listing objects in r2://$R2_BUCKET ..."
wrangler r2 object list "$R2_BUCKET" \
  --json 2>/dev/null > "${BACKUP_DIR}/${R2_BUCKET}-objects.json" || {
  warn "R2 listing failed (bucket may be empty or permissions insufficient)."
}
ok "Object list: ${BACKUP_DIR}/${R2_BUCKET}-objects.json"

# ─────────────────────────────────────────────────────────────────────────────
step "5. List Worker secrets"
# ─────────────────────────────────────────────────────────────────────────────

SECRETS_FILE="${BACKUP_DIR}/worker-secrets.txt"
: > "$SECRETS_FILE"

list_secrets() {
  local WORKER="$1"
  info "Listing secrets for $WORKER..."
  {
    echo "=== $WORKER ==="
    wrangler secret list --name "$WORKER" 2>/dev/null || echo "(none or worker not yet deployed)"
    echo
  } | tee -a "$SECRETS_FILE"
}

list_secrets "gdgjp-accounts"
list_secrets "gdgjp-tinyurl"
list_secrets "gdgjp-wiki"
list_secrets "gdgjp-img"

ok "Secret names saved to $SECRETS_FILE  (values are never exported -- re-set them manually)"

# ─────────────────────────────────────────────────────────────────────────────
step "Done -- next steps"
# ─────────────────────────────────────────────────────────────────────────────

cat <<EOF

  Export complete. Files are in: $BACKUP_DIR/

  -- Before running migrate-cf-2-import.sh ---------------------------------

  1. Create (or locate) the destination Cloudflare account.
     Note: Cloudflare owners must be individual emails, not group addresses.
     Use a service account such as cf-admin@gdgs.jp, then invite team members
     as Administrators from the dashboard.

  2. Switch wrangler to the NEW account:
       wrangler logout
       wrangler login
     Confirm you land on the correct account in the browser.

  3. Note the NEW account ID from the dashboard
     (Account Home -> top-right dropdown -> copy Account ID).

  4. Run:
       bash scripts/migrate-cf-2-import.sh

EOF
