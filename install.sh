#!/bin/sh
# md-boss installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/dux/md-boss/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/dux/md-boss/main/install.sh | sh -s -- --uninstall
#
# Nothing here needs root. curl sets no com.apple.quarantine attribute, so the unsigned
# macOS bundle opens without a Gatekeeper prompt - which is the whole reason the app is
# distributed this way rather than as a download link.
#
# MD_BOSS_VERSION=v0.2.0   pin a release
# MD_BOSS_PREFIX=~/.local  where bin/ and share/ go
# MD_BOSS_REPO=owner/name  pull from a fork

set -eu

REPO="${MD_BOSS_REPO:-dux/md-boss}"
PREFIX="${MD_BOSS_PREFIX:-$HOME/.local}"
APPS="/Applications"

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
say()  { printf '%s\n' "$*"; }
die()  { red "md-boss: $*" >&2; exit 1; }

# ---- what we are running on

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *)      die "unsupported system $(uname -s) - macOS and Linux only" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64)  arch=x64 ;;
  *)               die "unsupported architecture $(uname -m)" ;;
esac

if [ "$os-$arch" = "linux-arm64" ]; then
  die "no linux-arm64 build yet - build from source, see the README"
fi

target="$os-$arch"
share="$PREFIX/share/md-boss"
desktop="$PREFIX/share/applications/md-boss.desktop"
icon="$PREFIX/share/icons/hicolor/256x256/apps/md-boss.png"

stop_running() { pkill -x md-boss 2>/dev/null || true; }

# The shipped shim guesses a default install path. The installer knows the real one, so it
# is pinned in the copy that lands on PATH - otherwise MD_BOSS_PREFIX or the ~/Applications
# fallback would leave the command pointing at nothing.
install_shim() {
  shim=$1
  binary=$2
  {
    echo '#!/bin/sh'
    printf 'MD_BOSS_APP="%s"; export MD_BOSS_APP\n' "$binary"
    tail -n +2 "$shim"
  } > "$PREFIX/bin/md-boss"
  chmod 755 "$PREFIX/bin/md-boss"
}

# ---- uninstall

if [ "${1:-}" = "--uninstall" ]; then
  stop_running
  rm -rf "$APPS/MdBoss.app" "$HOME/Applications/MdBoss.app" "$share"
  rm -f "$PREFIX/bin/md-boss" "$desktop" "$icon"
  ok "md-boss removed."
  say "Settings and sidebar roots stay in ~/.config/md-boss - delete that folder too if you are done."
  exit 0
fi

command -v curl >/dev/null 2>&1 || die "curl is needed to install"

# ---- which release

if [ -n "${MD_BOSS_VERSION:-}" ]; then
  tag="$MD_BOSS_VERSION"
else
  # The /releases/latest redirect names the tag, so this needs neither the API nor its
  # unauthenticated rate limit. A repo with no releases redirects to /releases/tag/latest
  # and answers 200, so the tag it yields has to be sanity-checked rather than trusted.
  location=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") \
    || die "could not reach github.com, or $REPO is not public"
  tag="${location##*/tag/}"
  case "$tag" in
    v[0-9]* | [0-9]*) ;;
    latest) die "$REPO has no published release yet" ;;
    *)      die "unexpected release tag '$tag' in $REPO - expected vX.Y.Z" ;;
  esac
fi
version="${tag#v}"

asset="md-boss-$version-$target.tar.gz"
base="https://github.com/$REPO/releases/download/$tag"

# ---- fetch and verify

tmp=$(mktemp -d "${TMPDIR:-/tmp}/md-boss.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM

say "md-boss $version ($target)"
curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" || die "no $asset in release $tag"
curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || die "release $tag has no SHA256SUMS"

if command -v sha256sum >/dev/null 2>&1; then
  got=$(sha256sum "$tmp/$asset" | cut -d' ' -f1)
else
  got=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)
fi
want=$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/SHA256SUMS")
[ -n "$want" ] || die "$asset is not listed in SHA256SUMS"
[ "$got" = "$want" ] || die "checksum mismatch for $asset - download corrupted, try again"

tar xzf "$tmp/$asset" -C "$tmp"

# ---- install

stop_running
mkdir -p "$PREFIX/bin"

if [ "$os" = darwin ]; then
  dest="$APPS"
  # /Applications is admin-writable on a normal Mac; fall back rather than ask for sudo.
  if [ ! -w "$dest" ]; then
    dest="$HOME/Applications"
    mkdir -p "$dest"
    warn "/Applications is not writable - installing to $dest instead"
  fi
  rm -rf "$dest/MdBoss.app"
  mv "$tmp/MdBoss.app" "$dest/"
  # Belt and braces: curl sets no quarantine, but a re-run over a browser-downloaded copy might.
  xattr -dr com.apple.quarantine "$dest/MdBoss.app" 2>/dev/null || true
  install_shim "$dest/MdBoss.app/Contents/Resources/md-boss.sh" \
               "$dest/MdBoss.app/Contents/MacOS/md-boss"
  ok "installed $dest/MdBoss.app"
else
  rm -rf "$share"
  mkdir -p "$(dirname "$share")"
  mv "$tmp/md-boss" "$share"
  install_shim "$share/md-boss.sh" "$share/md-boss"

  mkdir -p "$(dirname "$desktop")" "$(dirname "$icon")"
  cp "$share/md-boss.png" "$icon"
  # Exec is the binary, not the shim: a launcher has no terminal to hand back.
  cat > "$desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=md-boss
Comment=A markdown viewer and editor that looks like paper
Exec=$share/md-boss %F
Icon=md-boss
Terminal=false
Categories=Office;Utility;TextEditor;
MimeType=text/markdown;text/plain;text/csv;inode/directory;
StartupWMClass=md-boss
DESKTOP
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$(dirname "$desktop")" 2>/dev/null || true
  fi
  ok "installed $share"
fi

ok "installed $PREFIX/bin/md-boss"

# ---- what the app still needs from the system

missing=0

if ! command -v bun >/dev/null 2>&1; then
  missing=1
  say ""
  warn "bun is not on PATH."
  say "  md-boss runs its backend with the locally installed bun. Install it:"
  say "    curl -fsSL https://bun.sh/install | bash"
  say "  https://bun.sh"
fi

if [ "$os" = linux ] && ! ldconfig -p 2>/dev/null | grep -q libwebkit2gtk-4.1; then
  missing=1
  say ""
  warn "WebKitGTK 4.1 is not installed."
  say "  md-boss draws in the system webview. Install it:"
  say "    Debian/Ubuntu  sudo apt install libwebkit2gtk-4.1-0"
  say "    Fedora         sudo dnf install webkit2gtk4.1"
  say "    Arch           sudo pacman -S webkit2gtk-4.1"
fi

case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *)
    missing=1
    say ""
    warn "$PREFIX/bin is not on PATH."
    say "  Add it, then reopen the terminal:"
    say "    echo 'export PATH=\"$PREFIX/bin:\$PATH\"' >> ~/.profile"
    ;;
esac

say ""
if [ "$missing" -eq 0 ]; then
  ok "Done. Run: md-boss ."
else
  say "Then run: md-boss ."
fi
