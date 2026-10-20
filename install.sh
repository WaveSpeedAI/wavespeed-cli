#!/usr/bin/env bash
# WaveSpeed CLI installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/WaveSpeedAI/wavespeed-cli/main/install.sh | bash
set -euo pipefail

PURPLE='\033[38;5;141m'
GREEN='\033[0;32m'
RED='\033[0;31m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

echo
echo -e "${PURPLE}${BOLD}  WaveSpeed CLI installer${NC}"
echo -e "${GRAY}  Every WaveSpeed model — straight from your terminal.${NC}"
echo

# No usable Node/npm? Fall back to the standalone executable from GitHub Releases.
install_binary() {
  local os arch asset base dir tmp want got
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) echo -e "${RED}Unsupported OS: $(uname -s).${NC} On Windows use install.ps1 (see README)."; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo -e "${RED}Unsupported CPU: $(uname -m).${NC}"; exit 1 ;;
  esac
  asset="wavespeed-${os}-${arch}"
  base="https://github.com/WaveSpeedAI/wavespeed-cli/releases/latest/download"
  dir="${WAVESPEED_INSTALL_DIR:-$HOME/.local/bin}"
  tmp="$(mktemp -d)"
  echo -e "${GRAY}Node.js/npm not found — downloading the standalone ${BOLD}${asset}${NC}${GRAY}…${NC}"
  curl -fsSL "$base/$asset" -o "$tmp/$asset" && curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" \
    || { echo -e "${RED}Download failed.${NC} Install Node.js from https://nodejs.org/ and re-run."; exit 1; }
  want="$(awk -v a="$asset" '$2 == a || $2 == "*" a {print $1}' "$tmp/SHA256SUMS")"
  got="$( (sha256sum "$tmp/$asset" 2>/dev/null || shasum -a 256 "$tmp/$asset") | awk '{print $1}')"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo -e "${RED}Checksum mismatch — not installing.${NC}"; exit 1
  fi
  mkdir -p "$dir" && install -m 0755 "$tmp/$asset" "$dir/wavespeed"
  rm -rf "$tmp"
  echo
  echo -e "${GREEN}✓ Installed to $dir/wavespeed.${NC}"
  case ":$PATH:" in *":$dir:"*) ;; *) echo -e "${BOLD}Add to PATH:${NC} export PATH=\"$dir:\$PATH\"" ;; esac
  echo
  echo -e "${BOLD}Next:${NC}  wavespeed login"
  exit 0
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 \
   || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  install_binary
fi

echo -e "${GRAY}Installing ${BOLD}wavespeed${NC}${GRAY} globally with npm…${NC}"
if npm install -g @wavespeed/cli; then
  :
else
  echo
  echo -e "${RED}Global install failed.${NC} You may need sudo, or to fix npm's prefix."
  echo -e "${GRAY}Workaround: ${NC}npx -y wavespeed login"
  exit 1
fi

echo
echo -e "${GREEN}✓ Installed.${NC}"
echo
echo -e "${BOLD}Next:${NC}"
echo -e "  wavespeed login"
echo -e "  wavespeed models                 # browse the catalog"
echo -e "  wavespeed run wavespeed-ai/z-image/turbo -p \"a cyberpunk skyline at golden hour\"   # ~5s"
echo
