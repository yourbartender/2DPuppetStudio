// Cross-platform runtime NDI v5/v6 video sender for Electron (macOS, Windows, Linux).
// Loads libndi.dylib (macOS) / Processing.NDI.Lib.x64.dll (Windows) / libndi.so (Linux)
// dynamically via koffi FFI — zero compile-time SDK dependency!

const fs = require("fs");
const path = require("path");

const NDI_FOURCC_BGRA = 0x41524742; // 'B','G','R','A'
const NDI_FRAME_PROGRESSIVE = 1;
const NDI_SEND_TIMECODE_SYNTHESIZE = BigInt("9223372036854775807"); // INT64_MAX

function candidateNdiPaths() {
  if (process.platform === "darwin") {
    return [
      "/usr/local/lib/libndi.dylib",
      "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib",
      "/Library/Application Support/NewTek/NDI/libndi.dylib",
      "libndi.dylib",
    ];
  }
  if (process.platform === "win32") {
    const dirs = [
      process.env.NDI_RUNTIME_DIR_V6,
      process.env.NDI_RUNTIME_DIR_V5,
      "C:\\Program Files\\NDI\\NDI 6 Runtime\\v6",
      "C:\\Program Files\\NDI\\NDI 5 Runtime\\v5",
      "C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime",
      "C:\\Program Files\\NDI\\NDI 5 Tools\\Runtime",
      "C:\\Program Files\\NewTek\\NDI 5 Runtime\\v5",
    ].filter(Boolean);
    const out = dirs.map((d) => path.join(d, "Processing.NDI.Lib.x64.dll"));
    out.push("Processing.NDI.Lib.x64.dll");
    return out;
  }
  return [
    "/usr/local/lib/libndi.so",
    "/usr/lib/libndi.so",
    "libndi.so.6",
    "libndi.so.5",
    "libndi.so",
  ];
}

class NdiSenderBridge {
  constructor() {
    this.koffi = null;
    this.lib = null;
    this.libPath = null;
    this.available = false;
    this.reason = "NDI runtime not detected";
    this.fnInit = null;
    this.fnSendCreate = null;
    this.fnSendDestroy = null;
    this.fnSendVideoV2 = null;
    this.SendCreateType = null;
    this.VideoFrameType = null;
    this.senderPtr = null;
    this.initialized = false;
    this.enabled = false;
    this.sourceName = "Puppet Studio";
    this.framesSent = 0;
    this.bgraBuf = null;
    this._probe();
  }

  _probe() {
    try {
      this.koffi = require("koffi");
    } catch (e) {
      this.available = false;
      this.reason = "koffi FFI module not installed";
      return;
    }

    const koffi = this.koffi;
    const candidates = candidateNdiPaths();
    for (const p of candidates) {
      try {
        if (path.isAbsolute(p) && !fs.existsSync(p)) continue;
        const lib = koffi.load(p);
        this.lib = lib;
        this.libPath = p;
        break;
      } catch {
        // try next candidate
      }
    }

    if (!this.lib) {
      this.available = false;
      this.reason =
        process.platform === "win32"
          ? "Install NDI Tools / Runtime (Processing.NDI.Lib.x64.dll)"
          : "Install NDI Tools / Runtime (/usr/local/lib/libndi.dylib)";
      return;
    }

    try {
      this.SendCreateType = koffi.struct("NDIlib_send_create_t", {
        p_ndi_name: "const char*",
        p_groups: "const char*",
        clock_video: "bool",
        clock_audio: "bool",
      });

      this.VideoFrameType = koffi.struct("NDIlib_video_frame_v2_t", {
        xres: "int32",
        yres: "int32",
        FourCC: "uint32",
        frame_rate_N: "int32",
        frame_rate_D: "int32",
        picture_aspect_ratio: "float",
        frame_format_type: "int32",
        timecode: "int64",
        p_data: "uint8*",
        line_stride_in_bytes: "int32",
        p_metadata: "const char*",
        timestamp: "int64",
      });

      this.fnInit = this.lib.func("bool NDIlib_initialize()");
      this.fnSendCreate = this.lib.func(
        "void* NDIlib_send_create(const NDIlib_send_create_t* p_create_settings)",
      );
      this.fnSendDestroy = this.lib.func("void NDIlib_send_destroy(void* p_instance)");
      this.fnSendVideoV2 = this.lib.func(
        "void NDIlib_send_send_video_v2(void* p_instance, const NDIlib_video_frame_v2_t* p_video_data)",
      );
      this.available = true;
      this.reason = `Ready (${path.basename(this.libPath)})`;
    } catch (err) {
      this.available = false;
      this.reason = `NDI ABI bind error: ${err.message}`;
    }
  }

  getStatus() {
    return {
      available: this.available,
      enabled: this.enabled,
      sourceName: this.sourceName,
      framesSent: this.framesSent,
      reason: this.reason,
    };
  }

  start(sourceName = "Puppet Studio") {
    if (!this.available) return this.getStatus();
    const cleanName = String(sourceName || "Puppet Studio").trim() || "Puppet Studio";
    if (this.enabled && this.senderPtr && this.sourceName === cleanName) {
      return this.getStatus();
    }
    this.stop();

    if (!this.initialized) {
      const ok = this.fnInit();
      if (!ok) {
        this.reason = "NDIlib_initialize() failed";
        return this.getStatus();
      }
      this.initialized = true;
    }

    this.sourceName = cleanName;
    this.senderPtr = this.fnSendCreate({
      p_ndi_name: cleanName,
      p_groups: null,
      clock_video: false,
      clock_audio: false,
    });

    if (!this.senderPtr) {
      this.reason = "NDIlib_send_create() returned null";
      this.enabled = false;
      return this.getStatus();
    }

    this.enabled = true;
    this.framesSent = 0;
    this.reason = `Streaming "${cleanName}"`;
    return this.getStatus();
  }

  stop() {
    if (this.senderPtr && this.fnSendDestroy) {
      try {
        this.fnSendDestroy(this.senderPtr);
      } catch {
        // ignore destroy errors
      }
    }
    this.senderPtr = null;
    this.enabled = false;
    if (this.available) {
      this.reason = "NDI Off";
    }
    return this.getStatus();
  }

  /** Receives straight-alpha RGBA Uint8Array from HTML5 Canvas, converts to BGRA, sends over NDI */
  sendRgbaFrame(width, height, rgbaBytes) {
    if (!this.enabled || !this.senderPtr || !rgbaBytes) return false;
    const expected = width * height * 4;
    if (rgbaBytes.byteLength < expected) return false;

    if (!this.bgraBuf || this.bgraBuf.length !== expected) {
      this.bgraBuf = Buffer.allocUnsafe(expected);
    }
    const src =
      rgbaBytes instanceof Uint8Array
        ? rgbaBytes
        : new Uint8Array(rgbaBytes.buffer, rgbaBytes.byteOffset || 0, expected);
    const dst = this.bgraBuf;

    // Straight-alpha RGBA -> Straight-alpha BGRA (swap R and B channels)
    for (let i = 0; i < expected; i += 4) {
      dst[i] = src[i + 2];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i];
      dst[i + 3] = src[i + 3];
    }

    try {
      this.fnSendVideoV2(this.senderPtr, {
        xres: width,
        yres: height,
        FourCC: NDI_FOURCC_BGRA,
        frame_rate_N: 30000,
        frame_rate_D: 1000,
        picture_aspect_ratio: width / Math.max(1, height),
        frame_format_type: NDI_FRAME_PROGRESSIVE,
        timecode: NDI_SEND_TIMECODE_SYNTHESIZE,
        p_data: dst,
        line_stride_in_bytes: width * 4,
        p_metadata: null,
        timestamp: BigInt(0),
      });
      this.framesSent += 1;
      return true;
    } catch (err) {
      console.error("NDI send frame error:", err);
      return false;
    }
  }
}

module.exports = { NdiSenderBridge };
