#!/usr/bin/env bash
# One-time setup of Detour on a fresh AWS Lightsail Ubuntu 24.04 instance.
# Run on the instance:  bash lightsail-setup.sh your.address   (e.g. 54-255-109-186.sslip.io)
# Installs Node 22 and Caddy (HTTPS from Let's Encrypt), clones the repo to /opt/detour and
# runs it as a service on 127.0.0.1:4100 behind Caddy. Keys go in /opt/detour/.env, typed on
# the server; this script never asks for them.
set -euo pipefail
DOMAIN="${1:?usage: bash lightsail-setup.sh your.domain}"
APP=/opt/detour

sudo apt-get update
sudo apt-get install -y curl git gpg debian-keyring debian-archive-keyring apt-transport-https

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy

if [ ! -d "$APP/.git" ]; then
  sudo git clone https://github.com/tomcode1000/detour.git "$APP"
  sudo chown -R "$USER":"$USER" "$APP"
fi

# The key names only; the values are pasted in with nano afterwards.
if [ ! -f "$APP/.env" ]; then
  cat > "$APP/.env" <<ENV
AIRWALLEX_CLIENT_ID=
AIRWALLEX_API_KEY=
DEEPSEEK_API_KEY=
UNITPOST_API_KEY=
MAIL_FROM=
DEMO_INBOX=
ENV
fi
grep -q '^PUBLIC_URL=' "$APP/.env" || echo "PUBLIC_URL=https://$DOMAIN" >> "$APP/.env"
chmod 600 "$APP/.env"

sudo tee /etc/systemd/system/detour.service >/dev/null <<UNIT
[Unit]
Description=Detour
After=network-online.target

[Service]
User=$USER
WorkingDirectory=$APP
ExecStart=/usr/bin/node src/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

# flush_interval -1 keeps the live updates (Server-Sent Events) streaming.
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:4100 {
    flush_interval -1
  }
}
CADDY

sudo systemctl daemon-reload
sudo systemctl enable detour caddy
sudo systemctl restart caddy

echo
echo "Done. Next: nano $APP/.env  (paste the values), then: sudo systemctl restart detour"
echo "Check it with: sudo systemctl status detour   and open https://$DOMAIN"
