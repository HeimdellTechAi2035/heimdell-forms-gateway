#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if ! id deploy >/dev/null 2>&1; then
  echo "Required deploy user does not exist."
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is not installed."
  exit 1
fi

install -d -o deploy -g deploy -m 0750 /var/www/forms-gateway
install -d -o deploy -g deploy -m 0750 /var/www/forms-gateway/releases
install -d -o deploy -g deploy -m 0750 /var/www/forms-gateway/shared

cat > /etc/systemd/system/forms-gateway.service <<EOF
[Unit]
Description=Heimdell Forms Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/var/www/forms-gateway/current
EnvironmentFile=-/var/www/forms-gateway/shared/.env
ExecStart=$NODE_BIN /var/www/forms-gateway/current/server.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/forms-gateway
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/sudoers.d/forms-gateway-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart forms-gateway
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status forms-gateway
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active forms-gateway
EOF

chmod 0440 /etc/sudoers.d/forms-gateway-deploy
visudo -cf /etc/sudoers.d/forms-gateway-deploy
systemctl daemon-reload
systemctl enable forms-gateway.service

echo "Forms gateway VPS bootstrap completed."
echo "The service will start after the first successful GitHub deployment."
