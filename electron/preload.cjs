// Exposes a tiny, safe printing API to the web app (contextIsolation on).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("synergeio", {
  listPrinters: () => ipcRenderer.invoke("list-printers"),
  printReceipt: (html, deviceName) => ipcRenderer.invoke("print-receipt", { html, deviceName }),
});
