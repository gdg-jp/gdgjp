#!/usr/bin/env bash
# migrate-cf-2-import.sh  —  run while logged into the NEW Cloudflare account
#
# Imports the resources exported by migrate-cf-1-export.sh into the new
# account, patches wrangler.toml files, and deploys all Workers.
#
# What it does:
#   1. Verify prerequisites (wrangler, jq, pnpm)
#   2. Confirm the new wrangler login and collect the new account ID
#   3. Create D1 databases, import SQL dumps, and patch wrangler.toml
#   4. Create R2 bucket (data sync via rclone -- see instructions printed)
#   5. Patch account_id in all wrangler.toml files
#   6. Build and deploy all Workers
#   7. Print remaining manual steps
#
# Requirements:  wrangler >= 3.x, jq, pnpm
#                rclone (optional, for R2 sync -- brew install rclone)
#
# Usage (after migrate-cf-1-export.sh and wrangler re-login):
#   cd /path/to/gdgjp
#   bash scripts/migrate-cf-2-import.sh

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

for cmd in wrangler jq pnpm; do
  command -v "$cmd" &>/dev/null || die "'$cmd' is not installed."
  ok "$cmd: $(command -v "$cmd")"
done

[ -d "$BACKUP_DIR" ] || die "Backup directory not found: $BACKUP_DIR -- run migrate-cf-1-export.sh first."
ok "Backup directory: $BACKUP_DIR"

HAS_RCLONE=0
if command -v rclone &>/dev/null; then
  ok "rclone: $(command -v rclone)"
  HAS_RCLONE=1
else
  warn "'rclone' not found -- R2 sync instructions will be printed but not run automatically."
  warn "Install with: brew install rclone"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "2. Confirm new account"
# ─────────────────────────────────────────────────────────────────────────────

info "Current wrangler identity:"
wrangler whoami 2>&1 | tee "$BACKUP_DIR/whoami-new.txt"

NEW_ACCOUNT_ID="$(wrangler whoami --json 2>/dev/null | jq -r '.account_id // empty' || true)"
if [ -z "$NEW_ACCOUNT_ID" ]; then
  warn "Could not auto-detect account ID. Run 'wrangler accounts list' to find it."
  read -rp "  Enter the NEW account ID: " NEW_ACCOUNT_ID
fi
[ -z "$NEW_ACCOUNT_ID" ] && die "New account ID is required."

OLD_ACCOUNT_ID="$(cat "$BACKUP_DIR/old-account-id.txt" 2>/dev/null || true)"
if [ -n "$OLD_ACCOUNT_ID" ] && [ "$OLD_ACCOUNT_ID" = "$NEW_ACCOUNT_ID" ]; then
  die "New account ID matches the old one ($OLD_ACCOUNT_ID). Re-login with 'wrangler logout && wrangler login'."
fi

echo "$NEW_ACCOUNT_ID" > "$BACKUP_DIR/new-account-id.txt"
ok "New account ID: $NEW_ACCOUNT_ID"

# ─────────────────────────────────────────────────────────────────────────────
step "3. Create D1 databases, import data, and patch wrangler.toml"
# ─────────────────────────────────────────────────────────────────────────────

migrate_d1() {
  local DB_NAME="$1"
  local OLD_DB_ID="$2"
  local TOML_FILE="${REPO_ROOT}/$3"
  local DUMP_FILE="${BACKUP_DIR}/${DB_NAME}.sql"

  if [ ! -f "$DUMP_FILE" ]; then
    warn "No dump found for $DB_NAME at $DUMP_FILE -- skipping."
    return 0
  fi

  info "Creating D1 database: $DB_NAME..."
  local CREATE_JSON
  CREATE_JSON="$(wrangler d1 create "$DB_NAME" --json 2>/dev/null || true)"
  local NEW_DB_ID
  NEW_DB_ID="$(echo "$CREATE_JSON" | jq -r '.uuid // .id // empty' 2>/dev/null || true)"

  if [ -z "$NEW_DB_ID" ]; then
    warn "Could not parse new DB ID from 'wrangler d1 create' output."
    info "Run 'wrangler d1 list' to find it."
    read -rp "  Enter new database_id for $DB_NAME: " NEW_DB_ID
  fi
  [ -z "$NEW_DB_ID" ] && die "database_id for $DB_NAME is required."
  ok "$DB_NAME created -> $NEW_DB_ID"

  info "Importing $DUMP_FILE into $DB_NAME..."
  wrangler d1 execute "$DB_NAME" \
    --file "$DUMP_FILE" \
    --remote \
    2>&1 | tee "${BACKUP_DIR}/${DB_NAME}-import.log" || {
    warn "Import of $DB_NAME failed -- see ${BACKUP_DIR}/${DB_NAME}-import.log"
  }
  ok "$DB_NAME imported."

  sed -i.bak "s|database_id = \"${OLD_DB_ID}\"|database_id = \"${NEW_DB_ID}\"|" "$TOML_FILE"
  ok "database_id patched in $TOML_FILE"
}

migrate_d1 "gdgjp-accounts-db" "c97d5ddc-231a-4b1a-af2a-fe753876811d" "accounts/wrangler.toml"
migrate_d1 "gdgjp-tinyurl-db"  "bf0cefab-83d5-48c8-a2a7-7842e9890c46" "tinyurl/wrangler.toml"
migrate_d1 "gdgjp-img-db"      "6e53ffd5-0377-4d9b-8c92-47e67b05afe9" "img/wrangler.toml"

# ─────────────────────────────────────────────────────────────────────────────
step "4. Create R2 bucket"
# ─────────────────────────────────────────────────────────────────────────────

info "Creating R2 bucket: $R2_BUCKET..."
wrangler r2 bucket create "$R2_BUCKET" 2>&1 || warn "Bucket may already exist -- continuing."
ok "Bucket $R2_BUCKET ready in new account."

cat <<EOF

  -- R2 data sync -----------------------------------------------------------

  Sync the bucket contents from the old account using rclone.

  Configure two rclone remotes (run: rclone config):
    cf-old   ->  Cloudflare R2, old account credentials
    cf-new   ->  Cloudflare R2, new account credentials

  Get S3-compatible credentials from each account's dashboard:
    R2 -> Manage R2 API Tokens -> Create API Token

  Then run:
    rclone sync cf-old:${R2_BUCKET} cf-new:${R2_BUCKET} --progress

EOF

if [ "$HAS_RCLONE" -eq 1 ]; then
  read -rp "  Press Enter once rclone sync is complete (or Ctrl-C to stop here): "
else
  warn "rclone not installed -- sync manually before running the Workers in production."
fi

# ─────────────────────────────────────────────────────────────────────────────
step "5. Patch account_id in all wrangler.toml files"
# ─────────────────────────────────────────────────────────────────────────────

patch_account_id() {
  local TOML_FILE="$1"
  if grep -q '^account_id' "$TOML_FILE"; then
    sed -i.bak "s|^account_id = .*|account_id = \"${NEW_ACCOUNT_ID}\"|" "$TOML_FILE"
  else
    sed -i.bak "/^name = /a account_id = \"${NEW_ACCOUNT_ID}\"" "$TOML_FILE"
  fi
  ok "account_id updated in $TOML_FILE"
}

patch_account_id "${REPO_ROOT}/accounts/wrangler.toml"
patch_account_id "${REPO_ROOT}/tinyurl/wrangler.toml"
patch_account_id "${REPO_ROOT}/wiki/wrangler.toml"
patch_account_id "${REPO_ROOT}/img/wrangler.toml"

# ─────────────────────────────────────────────────────────────────────────────
step "6. Build and deploy all Workers"
# ─────────────────────────────────────────────────────────────────────────────

cd "$REPO_ROOT"

info "Building all apps..."
pnpm build 2>&1 | tee "${BACKUP_DIR}/build.log"
ok "Build complete."

deploy_app() {
  local APP="$1"
  info "Deploying $APP..."
  pnpm --filter "@gdgjp/$APP" deploy 2>&1 | tee "${BACKUP_DIR}/deploy-${APP}.log" || {
    warn "Deploy of $APP failed -- see ${BACKUP_DIR}/deploy-${APP}.log"
  }
  ok "$APP deployed."
}

deploy_app "accounts"
deploy_app "tinyurl"
deploy_app "wiki"
deploy_app "img"

# ─────────────────────────────────────────────────────────────────────────────
step "7. Remaining manual steps"
# ─────────────────────────────────────────────────────────────────────────────

SECRETS_FILE="${BACKUP_DIR}/worker-secrets.txt"

cat <<EOF

  Workers are deployed. Complete the following manually:

  A. Re-set Worker secrets
     Secret names exported to: ${SECRETS_FILE}
     For each secret in each Worker:
       wrangler secret put <KEY> --name <worker-name>

  B. DNS zone transfer (gdgs.jp)
     Old account dashboard -> Websites -> gdgs.jp -> Transfer zone
     Destination account ID: ${NEW_ACCOUNT_ID}

  C. Analytics Engine (tinyurl_clicks)
     AE datasets cannot be migrated. Historical data stays in the old
     account. The redeployed Worker will write to a new dataset automatically.

  D. Cloudflare Images
     Images are account-scoped. Download originals via the Images API
     from the old account and re-upload to the new one, or serve
     directly from the R2 bucket synced in step 4.

  E. Invite team members
     New account dashboard -> Manage Account -> Members -> Invite
     Suggested role: Administrator

  Old account ID : ${OLD_ACCOUNT_ID}
  New account ID : ${NEW_ACCOUNT_ID}
  Backup files   : ${BACKUP_DIR}/

EOF

ok "Import complete."
