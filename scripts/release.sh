#!/usr/bin/env bash
#
# CodeGrid release — build, sign, notarize, and publish a GitHub release.
# Replaces the old GitHub Actions workflow; runs locally on a macOS machine
# that has the ZipLyne Developer ID cert in its keychain.
#
# Secrets are read from .env.local (gitignored):
#   TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
#   APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD
#
# Usage:  ./scripts/release.sh            # release the version in src-tauri/Cargo.toml
#         ./scripts/release.sh --bump     # bump above both the manifest and latest remote tag
#
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="ZipLyne-Agency/CodeGrid"

if [ ! -f .env.local ]; then
  echo "error: .env.local not found (needs signing/notarization secrets)" >&2
  exit 1
fi
set -a; . ./.env.local; set +a
# Tauri's notarizer reads APPLE_PASSWORD; keep the local secret name aligned
# with the GitHub workflow without requiring duplicate values in .env.local.
export APPLE_PASSWORD="$APPLE_APP_PASSWORD"

# Resolve the latest published tag from the remote, not commit count. This keeps
# versions monotonic even if main is replaced with a fresh-root history.
CUR=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')
TAGV=$(git ls-remote --tags --refs origin 'refs/tags/v*' \
  | awk '{print $2}' | sed 's#refs/tags/v##' \
  | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
  | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 || true)
BASE=$(printf '%s\n%s\n' "$CUR" "${TAGV:-0.0.0}" \
  | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)

# Optional patch bump
if [ "${1:-}" = "--bump" ]; then
  IFS='.' read -r MA MI PA <<< "$BASE"
  NEW="${MA}.${MI}.$((PA + 1))"
  echo "Bumping above manifest ${CUR} and remote ${TAGV:-none}: ${NEW}"
  sed -i '' "s/^version = \".*\"/version = \"${NEW}\"/" src-tauri/Cargo.toml
  sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW}\"/" src-tauri/tauri.conf.json
  sed -i '' "1,/\"version\":/{s/\"version\": \".*\"/\"version\": \"${NEW}\"/;}" package.json
  npm install --package-lock-only --ignore-scripts
  cargo check --manifest-path src-tauri/Cargo.toml
fi

VERSION=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')
if [ "$VERSION" = "${TAGV:-}" ] || [ "$VERSION" != "$(printf '%s\n%s\n' "$VERSION" "${TAGV:-0.0.0}" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" ]; then
  echo "error: version ${VERSION} is not newer than published ${TAGV}; rerun with --bump" >&2
  exit 1
fi
TAG="v${VERSION}"
echo "==> Releasing ${TAG}"

# Build (signed + updater artifacts; createUpdaterArtifacts is enabled in tauri.conf.json)
npm run tauri build -- --target aarch64-apple-darwin

BUNDLE="src-tauri/target/aarch64-apple-darwin/release/bundle"
DMG="${BUNDLE}/dmg/CodeGrid_${VERSION}_aarch64.dmg"
TARBALL="${BUNDLE}/macos/CodeGrid.app.tar.gz"
SIGFILE="${TARBALL}.sig"
APP="${BUNDLE}/macos/CodeGrid.app"

[ -d "$APP" ] || { echo "error: app not found at $APP" >&2; exit 1; }
[ -f "$DMG" ] || { echo "error: DMG not found at $DMG" >&2; exit 1; }
[ -f "$SIGFILE" ] || { echo "error: updater signature not found at $SIGFILE (is TAURI_SIGNING_PRIVATE_KEY set?)" >&2; exit 1; }

# Notarize + staple the DMG
echo "==> Notarizing ${DMG}"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" \
  --wait --timeout 20m
xcrun stapler staple "$DMG"

# Refuse to publish unless the app, installer, and updater archive all pass
# their platform trust checks with the configured updater public key.
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute -vv "$APP"
xcrun stapler validate "$APP"
codesign --verify --verbose=2 "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type install -vv "$DMG"

command -v minisign >/dev/null || {
  echo "error: minisign is required to verify the updater archive (brew install minisign)" >&2
  exit 1
}
DECODED_SIG="$(mktemp)"
trap 'rm -f "$DECODED_SIG"; rm -rf "${TMP_DIR:-}"' EXIT
node - "$SIGFILE" "$DECODED_SIG" <<'NODE'
const fs = require("node:fs");
const [source, destination] = process.argv.slice(2);
fs.writeFileSync(destination, Buffer.from(fs.readFileSync(source, "utf8").trim(), "base64"), { mode: 0o600 });
NODE
PUBKEY=$(node -e 'const c=require("./src-tauri/tauri.conf.json").plugins.updater.pubkey; process.stdout.write(Buffer.from(c,"base64").toString().split(/\r?\n/)[1])')
minisign -Vm "$TARBALL" -x "$DECODED_SIG" -P "$PUBKEY"

# Generate latest.json for the in-app auto-updater
SIG=$(/bin/cat "$SIGFILE")
TMP_DIR="$(mktemp -d)"; TMP_JSON="${TMP_DIR}/latest.json"
/bin/cat > "$TMP_JSON" <<JSON
{
  "version": "${VERSION}",
  "notes": "CodeGrid ${TAG}",
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://github.com/${REPO}/releases/download/${TAG}/CodeGrid.app.tar.gz",
      "signature": "${SIG}"
    }
  }
}
JSON

# Publish a new GitHub release. Existing releases are never overwritten.
echo "==> Publishing GitHub release ${TAG}"
gh release create "$TAG" "$DMG" "$TARBALL" "$TMP_JSON" \
  --repo "$REPO" \
  --title "CodeGrid ${TAG}" \
  --notes "CodeGrid ${TAG} — signed and notarized for macOS." \
  --latest

echo "==> Done: https://github.com/${REPO}/releases/tag/${TAG}"
