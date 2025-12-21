/**
 * ANDROPRINT – FINAL STABLE SERVER
 * --------------------------------
 * ✔ Persistent Server ID
 * ✔ Client Auth (ENABLE_AUTH)
 * ✔ Printer CRUD
 * ✔ Real TCP Printer Status
 * ✔ Real Test Print (no fake success)
 * ✔ Safe JSON handling
 * ✔ Localhost + 127.0.0.1
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");               // ✅ FIX 1
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");           // ✅ FIX 2

const app = express();
const PORT = process.env.PORT || 3000;
const ENABLE_AUTH = process.env.ENABLE_AUTH === "true";

/* ===============================
   BASE DIRECTORIES (IMPORTANT)
================================ */

const ROOT_DIR = path.join(__dirname, "..");
const CONFIG_DIR = path.join(ROOT_DIR, "config");
const PUBLIC_DIR = path.join(ROOT_DIR, "public"); // ✅ FIX 3

/* ===============================
   DATA FILE PATHS
================================ */

const PRINTER_FILE   = path.join(CONFIG_DIR, "printer.json");
const CLIENT_FILE    = path.join(CONFIG_DIR, "clients.json");
const SERVER_ID_FILE = path.join(CONFIG_DIR, "server.id");
const AUTH_FILE      = path.join(CONFIG_DIR, "auth.json");

/* ===============================
   MIDDLEWARE
================================ */

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));


/*------------------ SERVER ID ---------------- */

function getServerId() {
  if (fs.existsSync(SERVER_ID_FILE)) {
    return fs.readFileSync(SERVER_ID_FILE, "utf8").trim();
  }
  const id = "srv-" + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(SERVER_ID_FILE, id);
  return id;
}

const SERVER_ID = getServerId();

/* ---------------- SAFE JSON ---------------- */

function safeRead(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeWrite(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ---------------- LOADERS ---------------- */

function loadPrinters() {
  return safeRead(PRINTER_FILE, { printers: [] }).printers;
}

function savePrinters(printers) {
  safeWrite(PRINTER_FILE, { printers });
}

function loadClients() {
  return safeRead(CLIENT_FILE, { clients: [] }).clients;
}

function saveClients(clients) {
  safeWrite(CLIENT_FILE, { clients });
}

/* ---------------- AUTH ---------------- */

function authRequired(req, res, next) {
  if (!ENABLE_AUTH) return next();

  const cid = req.headers["x-client-id"];
  const key = req.headers["x-print-key"];

  if (!cid || !key) {
    return res.status(401).json({ error: "Client ID / Print Key missing" });
  }

  const client = loadClients().find(c => c.id === cid);

  if (!client || !client.enabled) {
    return res.status(403).json({ error: "Client not allowed" });
  }

  if (client.pin !== key) {
    return res.status(403).json({ error: "Invalid Print Key" });
  }

  req.client = client;
  next();
}

/* ---------------- TCP CHECK ---------------- */

function isPrinterOnline(ip, port, timeout = 1500) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let online = false;

    socket.setTimeout(timeout);
    socket.connect(port, ip, () => {
      online = true;
      socket.destroy();
    });

    socket.on("error", () => {});
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => resolve(online));
  });
}

/* ---------------- PRINT TEXT HELPER ---------------- */

async function printText(printer, text) {
  const device = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
    removeSpecialCharacters: false,
    characterSet: "SLOVENIA"
  });

  device.println(text);
  device.cut();

  await device.execute();
}

/* ---------------- API: SERVER INFO ---------------- */

app.get("/api/server", (req, res) => {
  res.json({
    serverId: SERVER_ID,
    auth: ENABLE_AUTH
  });
});

/* ---------------- API: CLIENTS ---------------- */

app.get("/api/clients", (req, res) => {
  res.json({ clients: loadClients() });
});

app.post("/api/client/create", (req, res) => {
  const clients = loadClients();
  const id = "clt-" + crypto.randomBytes(3).toString("hex");
  const pin = Math.floor(100000 + Math.random() * 900000).toString();

  const client = {
    id,
    pin,
    role: "CLIENT",
    enabled: true,
    createdAt: new Date().toISOString()
  };

  clients.push(client);
  saveClients(clients);

  res.json(client);
});

/* ---------------- API: PRINTERS ---------------- */

app.get("/api/printers", async (req, res) => {
  const printers = loadPrinters();

  const enriched = await Promise.all(
    printers.map(async p => ({
      ...p,
      online: await isPrinterOnline(
        p.connection.ip,
        p.connection.port
      )
    }))
  );

  res.json({ printers: enriched });
});

app.post("/api/printer/save", authRequired, (req, res) => {
  const printers = loadPrinters();
  const p = req.body;

  const index = printers.findIndex(x => x.id === p.id);
  if (index >= 0) printers[index] = p;
  else printers.push(p);

  savePrinters(printers);
  res.json({ success: true });
});

app.post("/api/printer/delete", authRequired, (req, res) => {
  const printers = loadPrinters().filter(p => p.id !== req.body.id);
  savePrinters(printers);
  res.json({ success: true });
});

/* ---------------- REAL TEST PRINT ---------------- */

app.post("/api/printer/test", authRequired, async (req, res) => {
  try {
    const { printerId } = req.body;
    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);

    if (!printer) {
      return res.status(404).json({ error: "Printer not found" });
    }

    const online = await isPrinterOnline(
      printer.connection.ip,
      printer.connection.port
    );

    if (!online) {
      return res.status(500).json({
        printed: false,
        error: "Printer offline"
      });
    }

    const tp = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
      timeout: 3000
    });

    tp.println("==== ANDROPRINT TEST ====");
    tp.println(`Printer: ${printer.name}`);
    tp.println(`Server : ${SERVER_ID}`);
    tp.println(new Date().toLocaleString());
    tp.cut();

    const ok = await tp.execute();
    if (!ok) throw new Error("Execute failed");

    res.json({ success: true, printed: true });

  } catch (e) {
    res.status(500).json({
      success: false,
      printed: false,
      error: e.message
    });
  }
});

app.post("/print", authRequired, async (req, res) => {
  try {
    const printerId =
      req.headers["x-printer-id"] || req.body.printerId;
    const text = req.body.text;

    if (!printerId || !text) {
      return res.status(400).json({
        error: "printerId or text missing"
      });
    }

    const printers = loadPrinters();
    const printer = printers.find(
      p => p.id === printerId && p.enabled
    );

    if (!printer) {
      return res.status(404).json({
        error: "Printer not found or disabled"
      });
    }

    await printText(printer, text);

    res.json({
      success: true,
      message: "Printed successfully",
      printerId
    });

  } catch (err) {
    console.error("PRINT ERROR:", err);
    res.status(500).json({
      error: err.message
    });
  }
});

/* ---------------- START ---------------- */

app.listen(PORT, () => {
  console.log("================================");
  console.log("ANDROPRINT SERVER RUNNING");
  console.log("Local URL :", `http://localhost:${PORT}`);
  console.log("Local IP  :", `http://127.0.0.1:${PORT}`);
  console.log("Server ID :", SERVER_ID);
  console.log("Auth      :", ENABLE_AUTH ? "ENABLED" : "DISABLED");
  console.log("================================");
});
