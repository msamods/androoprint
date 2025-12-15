/*************************************************
 * ANDROPRINT – FULL SERVER (TERMUX SAFE)
 *************************************************/

require("dotenv").config();
require("dotenv").config({ path: "printer.env" });

const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const { nanoid } = require("nanoid");
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");
const initSqlJs = require("sql.js");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PRINTER_ENV = "printer.env";
let db;

/* ================= DATABASE (sql.js) ================= */
async function initDB() {
  const SQL = await initSqlJs();
  const file = fs.existsSync("print_server.db")
    ? fs.readFileSync("print_server.db")
    : null;

  db = new SQL.Database(file);

  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT,
      pin TEXT,
      created_at INTEGER
    );
  `);

  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync("print_server.db", Buffer.from(data));
}

process.on("SIGINT", () => {
  saveDB();
  process.exit();
});

/* ================= SERVER ID ================= */
if (!process.env.SERVER_ID) {
  const sid = "srv-" + crypto.randomUUID();
  fs.appendFileSync(".env", `\nSERVER_ID=${sid}\n`);
  process.env.SERVER_ID = sid;
}

/* ================= PRINTER ENV HELPERS ================= */
function loadPrinters() {
  if (!fs.existsSync(PRINTER_ENV)) return {};
  const printers = {};

  fs.readFileSync(PRINTER_ENV, "utf8").split("\n").forEach(l => {
    if (!l || l.startsWith("#")) return;
    const [k, ...v] = l.split("=");
    if (!k.startsWith("PRINTER_")) return;

    const parts = k.split("_");
    const id = parts[1];
    const field = parts.slice(2).join("_").toLowerCase();

    printers[id] ??= { id };
    printers[id][field] = v.join("=");
  });

  return printers;
}

function savePrinters(printers) {
  let out = [];
  Object.values(printers).forEach(p => {
    out.push(`# ---- ${p.id} ----`);
    Object.entries(p).forEach(([k, v]) => {
      if (k === "id") return;
      out.push(`PRINTER_${p.id}_${k.toUpperCase()}=${v}`);
    });
    out.push("");
  });
  fs.writeFileSync(PRINTER_ENV, out.join("\n"));
}

/* ================= API ================= */

// Server info
app.get("/server-info", (_, res) => {
  res.json({ server_id: process.env.SERVER_ID });
});

// Register new client
app.post("/api/register-client", (req, res) => {
  const client_id = "clt-" + nanoid(6);
  const pin = Math.floor(100000 + Math.random() * 900000).toString();

  db.run(
    "INSERT INTO clients VALUES (NULL,?,?,?)",
    [client_id, pin, Date.now()]
  );
  saveDB();

  console.log("NEW CLIENT REGISTERED");
  console.log("CLIENT ID :", client_id);
  console.log("PIN       :", pin);

  res.json({ client_id, pin });
});

// List clients
app.get("/api/clients", (_, res) => {
  const r = db.exec("SELECT client_id, pin FROM clients");
  res.json(r[0]?.values || []);
});

/* ================= PRINTER ADMIN ================= */

// Load printers
app.get("/admin/printers", (_, res) => {
  res.json(loadPrinters());
});

// Add printer (max 3 per role)
app.post("/admin/printers/add", (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: "role required" });

  const printers = loadPrinters();
  const count = Object.values(printers).filter(p => p.role === role).length;
  if (count >= 3) return res.status(400).json({ error: "Limit reached" });

  const index = count + 1;
  const id = `${role}${index}`;

  printers[id] = {
    id,
    name: `${role} Printer ${index}`,
    role,
    ip: "0.0.0.0",
    port: "9100",
    width: role === "KITCHEN" ? "384" : "576",
    encoding: "PC437",
    cut: role === "KITCHEN" ? "false" : "true",
    align: role === "KITCHEN" ? "left" : "center",
    feed: role === "KITCHEN" ? "6" : "4",
    status: "disabled"
  };

  savePrinters(printers);
  res.json(printers[id]);
});

// Save / update printer
app.post("/admin/printers/save", (req, res) => {
  const printers = loadPrinters();
  printers[req.body.id] = req.body;
  savePrinters(printers);
  res.json({ ok: true });
});

// Test printer
app.post("/admin/printers/test", async (req, res) => {
  try {
    const printers = loadPrinters();
    const p = printers[req.body.id];
    if (!p) throw new Error("Printer not found");

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${p.ip}:${p.port}`,
      characterSet: p.encoding || "PC437"
    });

    printer.println("ANDROPRINT TEST");
    printer.println(p.name || p.id);
    printer.feed(Number(p.feed || 3));
    if (p.cut === "true") printer.cut();

    await printer.execute();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ================= PRINT API ================= */
app.post("/print/text", (req, res) => {
  const { client_id, pin, printer_id, text } = req.body;
  if (!client_id || !pin) return res.sendStatus(401);

  const r = db.exec(
    `SELECT * FROM clients WHERE client_id='${client_id}' AND pin='${pin}'`
  );
  if (!r[0]) return res.sendStatus(403);

  try {
    const printers = loadPrinters();
    const p = printers[printer_id];
    if (!p || p.status !== "enabled") throw new Error("Printer unavailable");

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${p.ip}:${p.port}`,
      characterSet: p.encoding || "PC437"
    });

    printer.println(text || "");
    printer.feed(Number(p.feed || 3));
    if (p.cut === "true") printer.cut();
    printer.execute();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => {
    console.log("\n══════════════════════════════════");
    console.log("🖨️ ANDROPRINT SERVER STARTED");
    console.log("SERVER ID :", process.env.SERVER_ID);
    console.log("PORT      :", PORT);
    console.log("══════════════════════════════════\n");
  });
});
