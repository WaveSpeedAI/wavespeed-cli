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

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Node.js is required${NC} (>= 18). Install from https://nodejs.org/ and re-run."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}Node.js 18+ required.${NC} Found: $(node -v)"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}npm is required.${NC} Install Node.js (includes npm) and re-run."
  exit 1
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
