#!/bin/sh

set -eu

repository=${FLOWMARK_REPOSITORY:-carlosray/flowmark}
version=${FLOWMARK_VERSION:-}

fail() {
  printf '%s\n' "flowmark installer: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."
command -v install >/dev/null 2>&1 || fail "install is required."
command -v awk >/dev/null 2>&1 || fail "awk is required."

system=$(uname -s) || fail "could not detect the operating system."
machine=$(uname -m) || fail "could not detect the machine architecture."

case "$system" in
  Darwin) platform=darwin ;;
  Linux) platform=linux ;;
  *) fail "unsupported operating system: $system." ;;
esac

case "$machine" in
  arm64 | aarch64) architecture=arm64 ;;
  x86_64 | amd64) architecture=x64 ;;
  *) fail "unsupported machine architecture: $machine." ;;
esac

if [ "$platform" = "linux" ] && [ "$architecture" = "arm64" ]; then
  fail "Linux ARM64 release binaries are not available yet."
fi

if [ -n "$version" ]; then
  case "$version" in
    *[!A-Za-z0-9._-]*) fail "invalid FLOWMARK_VERSION: $version." ;;
  esac
  download_base="https://github.com/$repository/releases/download/$version"
else
  download_base="https://github.com/$repository/releases/latest/download"
fi

asset="flowmark-$platform-$architecture.tar.gz"
install_directory=${FLOWMARK_INSTALL_DIR:-"${HOME:?HOME is required when FLOWMARK_INSTALL_DIR is not set}/.local/bin"}
temporary_directory=
temporary_target=

cleanup() {
  if [ -n "$temporary_target" ]; then
    rm -f "$temporary_target"
  fi
  if [ -n "$temporary_directory" ]; then
    rm -rf "$temporary_directory"
  fi
}

trap cleanup 0
trap 'exit 1' HUP INT TERM

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/flowmark-install.XXXXXX") ||
  fail "could not create a temporary directory."
archive="$temporary_directory/$asset"
checksums="$temporary_directory/SHA256SUMS"

printf '%s\n' "Downloading $asset..."
curl -fsSL -o "$archive" "$download_base/$asset" ||
  fail "could not download $asset."
curl -fsSL -o "$checksums" "$download_base/SHA256SUMS" ||
  fail "could not download SHA256SUMS."

expected_checksum=$(
  awk -v file="$asset" '$2 == file || $2 == ("*" file) { print $1; exit }' "$checksums"
)
[ -n "$expected_checksum" ] ||
  fail "SHA256SUMS does not contain an entry for $asset."

if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum=$(sha256sum "$archive" | awk '{ print $1 }')
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum=$(shasum -a 256 "$archive" | awk '{ print $1 }')
else
  fail "sha256sum or shasum is required for checksum verification."
fi

[ "$actual_checksum" = "$expected_checksum" ] ||
  fail "checksum verification failed for $asset."

extracted="$temporary_directory/extracted"
mkdir "$extracted"
tar -xzf "$archive" -C "$extracted" ||
  fail "could not extract $asset."
[ -f "$extracted/flowmark" ] ||
  fail "the release archive does not contain a flowmark executable."

mkdir -p "$install_directory" ||
  fail "could not create $install_directory."
temporary_target="$install_directory/.flowmark-install-$$"
install -m 0755 "$extracted/flowmark" "$temporary_target" ||
  fail "could not prepare the Flowmark executable."
mv "$temporary_target" "$install_directory/flowmark" ||
  fail "could not install Flowmark into $install_directory."
temporary_target=

printf '%s\n' "Installed Flowmark to $install_directory/flowmark"
case ":${PATH:-}:" in
  *":$install_directory:"*) ;;
  *)
    printf '%s\n' "Add $install_directory to PATH, then run: flowmark --help"
    ;;
esac
