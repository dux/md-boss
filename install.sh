#!/bin/bash
# Installs the latest MdBoss release from GitHub: the universal dmg into /Applications on
# macOS, the deb (or the AppImage where there is no apt) on Linux. Windows takes the
# MdBoss_<version>_x64-setup.exe or the .msi from the release page.
#
#   curl -fsSL https://raw.githubusercontent.com/dux/md-boss/main/install.sh | bash
#
# PREFIX=/usr/local puts the `md-boss` command into /usr/local/bin instead of ~/bin (macOS).

set -eu

APP_NAME="MdBoss"
REPO="dux/md-boss"
BIN_DIR="${PREFIX:-$HOME}/bin"

die() { echo "ERROR: $*" >&2; exit 1; }
as_root() { if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi; }

# The bundle names carry the version (MdBoss_0.1.0_universal.dmg) and releases/latest
# only redirects to the tag page, so the tag is read off that redirect - no API, no JSON.
latest_version() {
  local url
  url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" || return 1
  url="${url##*/}"
  echo "${url#v}"
}

download() {
  echo "* Downloading $1..."
  curl -fSL --progress-bar "https://github.com/$REPO/releases/download/v$VERSION/$1" -o "$TMP_DIR/$1" \
    || die "Download failed: $1 is not on release v$VERSION"
}

install_cli() {
  mkdir -p "$BIN_DIR"
  install -m 755 "$1" "$BIN_DIR/md-boss" || die "Could not write $BIN_DIR/md-boss"
  echo "* Installed $BIN_DIR/md-boss"
  [[ ":$PATH:" == *":$BIN_DIR:"* ]] || echo "* Add $BIN_DIR to PATH for the md-boss command"
}

install_macos() {
  local dmg="${APP_NAME}_${VERSION}_universal.dmg" mnt="$TMP_DIR/mnt" install_dir="/Applications"
  download "$dmg"
  mkdir -p "$mnt"
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$mnt" "$TMP_DIR/$dmg" || die "Could not mount $dmg"
  [[ -d "$mnt/$APP_NAME.app" ]] || die "$dmg does not contain $APP_NAME.app"

  # A running copy holds the bundle we are about to replace.
  pkill -x md-boss 2>/dev/null && sleep 0.5 || true

  rm -rf "$install_dir/$APP_NAME.app"
  cp -R "$mnt/$APP_NAME.app" "$install_dir/" || die "Could not write to $install_dir"
  hdiutil detach -quiet "$mnt" || true

  # curl does not quarantine, but a dmg downloaded by a browser does, and a quarantined
  # ad-hoc signature is refused rather than prompted for.
  xattr -dr com.apple.quarantine "$install_dir/$APP_NAME.app" 2>/dev/null || true

  # Ad-hoc signing gives every build a new identity, so LaunchServices has to be told
  # before .md files bind to this one.
  local lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  [[ -x "$lsregister" ]] && "$lsregister" -f "$install_dir/$APP_NAME.app" || true

  echo "* Installed to $install_dir/$APP_NAME.app"
  # The launcher ships inside the bundle; it execs the app so `md-boss .` resolves against the shell's cwd.
  install_cli "$install_dir/$APP_NAME.app/Contents/Resources/bin/md-boss"
  open "$install_dir/$APP_NAME.app"
}

install_linux() {
  [[ "$(uname -m)" == "x86_64" ]] || die "Linux builds are x86_64 only (this machine is $(uname -m))"

  if command -v apt-get >/dev/null 2>&1; then
    local deb="${APP_NAME}_${VERSION}_amd64.deb"
    download "$deb"
    # apt-get pulls the webkit2gtk / gtk dependencies along; dpkg -i alone would not.
    as_root apt-get install -y "$TMP_DIR/$deb" || die "apt-get install failed"
    echo "* Installed package md-boss: /usr/bin/md-boss"
  else
    local appimage="${APP_NAME}_${VERSION}_amd64.AppImage" dir="$HOME/.local/bin"
    download "$appimage"
    mkdir -p "$dir"
    install -m 755 "$TMP_DIR/$appimage" "$dir/$APP_NAME.AppImage"
    ln -sf "$APP_NAME.AppImage" "$dir/md-boss"
    echo "* Installed $dir/$APP_NAME.AppImage and the md-boss link next to it"
    [[ ":$PATH:" == *":$dir:"* ]] || echo "* Add $dir to PATH for the md-boss command"
  fi
}

OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *) die "No installer for $OS - pick a bundle at https://github.com/$REPO/releases/latest" ;;
esac

echo "* Installing $APP_NAME..."
TMP_DIR="$(mktemp -d)"
# The dmg may still be mounted under TMP_DIR when a step fails; detach before the rm.
cleanup() {
  [[ -d "$TMP_DIR/mnt" ]] && hdiutil detach -quiet "$TMP_DIR/mnt" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

VERSION="$(latest_version)" || die "Could not find the latest release of $REPO"
echo "* Latest release: $VERSION"

case "$OS" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
esac
