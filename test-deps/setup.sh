#!/bin/bash
# Download and extract shared libraries needed for Playwright e2e tests.
# No sudo required — uses curl + dpkg -x against archive.ubuntu.com.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"
DEBS_DIR="$SCRIPT_DIR/debs"
EXTRACT_DIR="$SCRIPT_DIR/_extract"
mkdir -p "$LIB_DIR" "$DEBS_DIR" "$EXTRACT_DIR"

BASE_URL="http://archive.ubuntu.com/ubuntu"

PACKAGES=(
    "libnss3"
    "libnspr4"
    "libdbus-1-3"
    "libatk1.0-0t64"
    "libatk-bridge2.0-0t64"
    "libatspi2.0-0t64"
    "libxcomposite1"
    "libxdamage1"
    "libxfixes3"
    "libxrandr2"
    "libgbm1"
    "libxkbcommon0"
    "libasound2t64"
    "libsqlite3-0"
    "libsystemd0"
    "libglib2.0-0t64"
    "libx11-6"
    "libxi6"
    "libxext6"
    "libxrender1"
    "libdrm2"
    "libexpat1"
    "libwayland-server0"
    "libxcb1"
    "libxcb-randr0"
    "libxcb-render0"
)

# Download and cache noble Packages files
fetch_packages_gz() {
    local comp="$1"
    local url="$BASE_URL/dists/noble/$comp/binary-amd64/Packages.gz"
    local out="/tmp/packages-e2e-${comp}.gz"
    [ -f "$out" ] || curl -sL -o "$out" "$url"
    echo "$out"
}

MAIN_PKGS=$(fetch_packages_gz main)
UNIVERSE_PKGS=$(fetch_packages_gz universe)

get_filename() {
    local pkg="$1"
    local file="$2"
    zcat "$file" 2>/dev/null | awk -v pkg="$pkg" '
        /^Package: / { if ($2 == pkg) { found=1; next } found=0 }
        found && /^Filename: / { print $2; exit }
    '
}

for pkg in "${PACKAGES[@]}"; do
    filename=$(get_filename "$pkg" "$MAIN_PKGS")
    [ -z "$filename" ] && filename=$(get_filename "$pkg" "$UNIVERSE_PKGS")
    [ -z "$filename" ] && { echo "SKIP $pkg — not found"; continue; }

    deb_name=$(basename "$filename")
    deb_path="$DEBS_DIR/$deb_name"
    [ -f "$deb_path" ] || { echo "DL $deb_name"; curl -sL -o "$deb_path" "$BASE_URL/$filename"; }

    dpkg -x "$deb_path" "$EXTRACT_DIR"
done

# Move .so files into lib/ (flat directory for LD_LIBRARY_PATH)
find "$EXTRACT_DIR" -name '*.so*' -exec cp -a {} "$LIB_DIR/" \;
rm -rf "$EXTRACT_DIR"

echo "Done — $(find "$LIB_DIR" -name '*.so*' | wc -l) shared libraries in $LIB_DIR"
