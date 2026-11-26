// Preload — exposes a safe OSC + NDI bridge to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oscBridge", {
  isElectron: true,
  send: (host, port, messages) => ipcRenderer.invoke("osc:send", host, port, messages),
  ndiStatus: () => ipcRenderer.invoke("ndi:status"),
  ndiStart: (sourceName) => ipcRenderer.invoke("ndi:start", sourceName),
  ndiStop: () => ipcRenderer.invoke("ndi:stop"),
  ndiSendFrame: (width, height, rgbaBytes) =>
    ipcRenderer.send("ndi:frame", width, height, rgbaBytes),
});
