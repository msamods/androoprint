# 🖨️ AndroPrint – Android Thermal Print Server (ESC/POS)

AndroPrint converts an Android phone into a fully operational
multi-printer thermal print server using Termux + Node.js.

No PC. No root. POS-grade architecture.

## Features
- Multi-printer (Cashier / Kitchen)
- Secure PIN + Client ID
- Admin Web UI
- printer.env based configuration
- PM2 background service
- Cloudflare tunnel support
- ASCII / Text / Image printing

## Start
```bash
cp .env.example .env
bash setup.sh
node server.js
