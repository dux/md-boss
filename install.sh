#!/bin/bash

APP_NAME="MdBoss"
REPO="dux/md-boss"
INSTALL_DIR="/Applications"
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$APP_NAME.app.tar.gz"

[[ "$(uname)" == "Darwin" ]] || { echo "ERROR: macOS required"; exit 1; }

echo "* Installing $APP_NAME..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "* Downloading..."
curl -fSL "$DOWNLOAD_URL" -o "$TMP_DIR/$APP_NAME.app.tar.gz" || { echo "ERROR: Download failed"; exit 1; }
tar -xzf "$TMP_DIR/$APP_NAME.app.tar.gz" -C "$TMP_DIR"
[[ -d "$TMP_DIR/$APP_NAME.app" ]] || { echo "ERROR: Bad archive"; exit 1; }

# A running copy holds the bundle we are about to replace.
pkill -x "$APP_NAME" 2>/dev/null && sleep 0.5 || true

rm -rf "$INSTALL_DIR/$APP_NAME.app"
cp -R "$TMP_DIR/$APP_NAME.app" "$INSTALL_DIR/" || { echo "ERROR: Could not write to $INSTALL_DIR"; exit 1; }

# curl does not quarantine, but a browser download unpacked by hand does, and a
# quarantined ad-hoc signature is refused rather than prompted for.
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME.app" 2>/dev/null || true

# Ad-hoc signing gives every build a new identity, so LaunchServices has to be told
# before .md files bind to this one.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f "$INSTALL_DIR/$APP_NAME.app"

echo "* Installed to $INSTALL_DIR/$APP_NAME.app"
echo "* The app writes the 'md-boss' command into ~/bin on first launch."

open "$INSTALL_DIR/$APP_NAME.app"
