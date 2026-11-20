// Preload — exposes a tiny safe bridge to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oscBridge", {
  isElectron: true,
  send: (host, port, messages) => ipcRenderer.invoke("osc:send", host, port, messages),
});
