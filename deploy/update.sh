#!/usr/bin/env bash
# Pull the latest Detour from GitHub and restart it. Run on the server: bash /opt/detour/deploy/update.sh
set -euo pipefail
cd /opt/detour
git pull --ff-only
sudo systemctl restart detour
sudo systemctl --no-pager status detour | head -n 5
