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
#         ./scripts/release.sh --bump     # bump the patch version first, then release
#
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="ZipLyne-Agency/CodeGrid-Claude-Code-Terminal"

if [ ! -f .env.local ]; then
  echo "error: .env.local not found (needs signing/notarization secrets)" >&2
  exit 1
fi
set -a; . ./.env.local; set +a

# Optional patch bump
if [ "${1:-}" = "--bump" ]; then
  CUR=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')
  IFS='.' read -r MA MI PA <<< "$CUR"
  NEW="${MA}.${MI}.$((PA + 1))"
  echo "Bumping ${CUR} -> ${NEW}"
  sed -i '' "s/^version = \".*\"/version = \"${NEW}\"/" src-tauri/Cargo.toml
  sed -i '' "s/\"version\": \".*\"/\"version\": \"${NEW}\"/" src-tauri/tauri.conf.json
  sed -i '' "1,/\"version\":/{s/\"version\": \".*\"/\"version\": \"${NEW}\"/;}" package.json
fi

VERSION=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')
TAG="v${VERSION}"
echo "==> Releasing ${TAG}"

# Build (signed + updater artifacts; createUpdaterArtifacts is enabled in tauri.conf.json)
npm run tauri build -- --target aarch64-apple-darwin

BUNDLE="src-tauri/target/aarch64-apple-darwin/release/bundle"
DMG="${BUNDLE}/dmg/CodeGrid_${VERSION}_aarch64.dmg"
TARBALL="${BUNDLE}/macos/CodeGrid.app.tar.gz"
SIGFILE="${TARBALL}.sig"

[ -f "$DMG" ] || { echo "error: DMG not found at $DMG" >&2; exit 1; }
[ -f "$SIGFILE" ] || { echo "error: updater signature not found at $SIGFILE (is TAURI_SIGNING_PRIVATE_KEY set?)" >&2; exit 1; }

# Notarize + staple the DMG
echo "==> Notarizing ${DMG}"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" \
  --wait --timeout 20m
xcrun stapler staple "$DMG"

# Generate latest.json for the in-app auto-updater
SIG=$(/bin/cat "$SIGFILE")
TMP_DIR="$(mktemp -d)"; TMP_JSON="${TMP_DIR}/latest.json"
/bin/cat > "$TMP_JSON" <<JSON
{
  "version": "${TAG}",
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

# Publish the GitHub release (replace if the tag already exists)
echo "==> Publishing GitHub release ${TAG}"
gh release delete "$TAG" --repo "$REPO" --yes 2>/dev/null || true
git tag -f "$TAG" >/dev/null 2>&1 || true
gh release create "$TAG" "$DMG" "$TARBALL" "$TMP_JSON" \
  --repo "$REPO" \
  --title "CodeGrid ${TAG}" \
  --notes "CodeGrid ${TAG} — signed and notarized for macOS." \
  --latest

echo "==> Done: https://github.com/${REPO}/releases/tag/${TAG}"
