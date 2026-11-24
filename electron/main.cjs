// Electron main process for the desktop build. It starts the app's own server
// (embedded PostgreSQL via PGlite) on 127.0.0.1 and opens a window to it, so the
// whole thing runs locally with no cloud and no separate database.
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

let serverUrl = null;

/** Reads the local encryption key (for stored AADE credentials), creating it once. */
function ensureKey(file) {
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* not created yet */
  }
  const key = crypto.randomBytes(32).toString("base64");
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

/** Copies the database folder into backups/, keeping the last 10. Best-effort. */
function backup(dataDir, backupsDir) {
  try {
    if (!fs.existsSync(dataDir)) return;
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.cpSync(dataDir, path.join(backupsDir, `backup-${stamp}`), { recursive: true });
    const old = fs
      .readdirSync(backupsDir)
      .filter((n) => n.startsWith("backup-"))
      .sort();
    for (const name of old.slice(0, Math.max(0, old.length - 10))) {
      fs.rmSync(path.join(backupsDir, name), { recursive: true, force: true });
    }
  } catch (e) {
    console.error("backup failed", e);
  }
}

async function startServer() {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  const backupsDir = path.join(userData, "backups");
  fs.mkdirSync(dataDir, { recursive: true });
  const encryptionKey = ensureKey(path.join(userData, "enc.key"));
  const staticDir = path.join(__dirname, "..", "web", "dist");

  const { startDesktopServer } = await import("./desktop-server.mjs");
  const res = await startDesktopServer({ dataDir, staticDir, encryptionKey });
  serverUrl = res.url;

  backup(dataDir, backupsDir);
  setInterval(() => backup(dataDir, backupsDir), 6 * 60 * 60 * 1000);
  app.on("before-quit", () => backup(dataDir, backupsDir));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    title: "Συνεργείο",
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(serverUrl);
  // Links that open a new window go to the system browser, not an in-app popup.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  // A minimal menu with the essentials (copy/paste, reload, quit).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Αρχείο", submenu: [{ role: "quit", label: "Έξοδος" }] },
      {
        label: "Επεξεργασία",
        submenu: [
          { role: "undo", label: "Αναίρεση" },
          { role: "redo", label: "Επανάληψη" },
          { type: "separator" },
          { role: "cut", label: "Αποκοπή" },
          { role: "copy", label: "Αντιγραφή" },
          { role: "paste", label: "Επικόλληση" },
          { role: "selectAll", label: "Επιλογή όλων" },
        ],
      },
      { label: "Προβολή", submenu: [{ role: "reload", label: "Ανανέωση" }, { role: "togglefullscreen", label: "Πλήρης οθόνη" }] },
    ]),
  );

  try {
    await startServer();
    createWindow();
  } catch (e) {
    dialog.showErrorBox("Σφάλμα εκκίνησης", String((e && e.stack) || e));
    app.quit();
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
