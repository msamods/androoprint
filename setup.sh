#!/data/data/com.termux/files/usr/bin/bash
set -e

SPIN='|/-\'
PERCENT=0

progress () {
  printf "\r[%3d%%] %s" "$1" "$2"
}

spinner () {
  while true; do
    for i in $(seq 0 3); do
      printf "\r[%3d%%] %s %s" "$PERCENT" "$1" "${SPIN:$i:1}"
      sleep 0.1
    done
  done
}

clear
echo "======================================"
echo " AndroPrint – One Click Setup"
echo "======================================"
echo ""

PERCENT=5
progress $PERCENT "Updating system"
pkg update -y >/dev/null 2>&1

PERCENT=15
progress $PERCENT "Upgrading system"
pkg upgrade -y >/dev/null 2>&1

PERCENT=30
progress $PERCENT "Installing system packages"
pkg install -y nodejs git curl jq sqlite netcat-openbsd poppler imagemagick cloudflared >/dev/null 2>&1

PERCENT=50
progress $PERCENT "Installing Node dependencies"
spinner "npm install" &
SPINNER_PID=$!
npm install --silent
kill $SPINNER_PID >/dev/null 2>&1

PERCENT=75
progress $PERCENT "Installing PM2"
npm install -g pm2 --silent

PERCENT=85
progress $PERCENT "Preparing environment"
[ ! -f ".env" ] && [ -f ".env.example" ] && cp .env.example .env
mkdir -p uploads

PERCENT=100
progress $PERCENT "Setup complete"
echo ""
echo ""
echo "======================================"
echo " ✅ AndroPrint Setup Completed"
echo "======================================"
echo ""
echo " Start server:"
echo "   node server.js"
echo ""
echo " Admin panel:"
echo "   http://localhost:3000/printer.html"
echo ""
