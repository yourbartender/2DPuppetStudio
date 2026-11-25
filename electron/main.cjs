// Electron main process. CommonJS (.cjs) because package.json has "type": "module".
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const osc = require("osc");

let win = null;
let udpPort = null;
let udpReadyPromise = null;

function createWindow() {
  win = new BrowserWindow({
    title: "Puppet Studio",
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#1b1f24",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Allow camera without prompt inside packaged app
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "media") return callback(true);
    callback(true);
  });

  win.loadFile(path.join(__dirname, "..", "dist-electron", "index.html"));
}

function ensureUdp() {
  if (udpPort) return { port: udpPort, ready: udpReadyPromise };
  const u = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 0, // ephemeral
    metadata: true,
  });
  u._ready = false;
  udpReadyPromise = new Promise((resolve) => {
    u.once("ready", () => {
      u._ready = true;
      resolve();
    });
  });
  u.on("error", (err) => {
    console.error("osc udp error", err);
  });
  u.open();
  udpPort = u;
  return { port: udpPort, ready: udpReadyPromise };
}

ipcMain.handle("osc:send", async (_evt, host, port, messages) => {
  const cleanHost = typeof host === "string" ? host.trim() : "";
  const cleanPort = Number(port);
  if (
    !cleanHost ||
    !Number.isInteger(cleanPort) ||
    cleanPort < 1 ||
    cleanPort > 65535 ||
    !Array.isArray(messages) ||
    messages.length === 0
  ) {
    return false;
  }

  const { port: u, ready } = ensureUdp();
  if (!u._ready && ready) {
    await ready;
  }

  for (const m of messages) {
    try {
      u.send(
        {
          address: m.address,
          args: m.args.map((a) =>
            typeof a === "number"
              ? { type: "f", value: a }
              : typeof a === "string"
                ? { type: "s", value: a }
                : { type: a ? "T" : "F", value: Boolean(a) },
          ),
        },
        cleanHost,
        cleanPort,
      );
    } catch (e) {
      // swallow per-message errors so one bad msg doesn't kill the stream
      console.error("osc send error", e);
    }
  }
  return true;
});

app.whenReady().then(createWindow);

app.on("will-quit", () => {
  if (udpPort) {
    try {
      udpPort.close();
    } catch {
      // ignore close errors
    }
    udpPort = null;
    udpReadyPromise = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
