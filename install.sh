#!/usr/bin/env bash
# Build and install the ScreenCast Linux GNOME extension for the current user.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
UUID="screencast-linux@adgsenpai.github.com"

mkdir -p "$ROOT/dist"
gnome-extensions pack "$ROOT/$UUID" --force --extra-source=icons --out-dir="$ROOT/dist"
gnome-extensions install --force "$ROOT/dist/$UUID.shell-extension.zip"

if ! command -v scrcpy >/dev/null; then
    echo "Note: scrcpy is not installed. Install it with: sudo apt install scrcpy"
fi

echo "Installed. Log out and back in (Wayland) or press Alt+F2 → r (X11), then run:"
echo "  gnome-extensions enable $UUID"
