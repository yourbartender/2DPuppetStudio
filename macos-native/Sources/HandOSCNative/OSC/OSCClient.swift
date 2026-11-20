import Foundation
import Darwin

public enum OSCValue: Sendable {
    case float(Float)
    case int(Int32)
    case string(String)
    case bool(Bool)
}

public struct OSCMessage: Sendable {
    public var address: String
    public var args: [OSCValue]

    public init(address: String, args: [OSCValue]) {
        self.address = address
        self.args = args
    }

    public init(address: String, floats: [Float]) {
        self.address = address
        self.args = floats.map { .float($0) }
    }
}

public final class OSCClient: @unchecked Sendable {
    private var socketFd: Int32 = -1
    private var cachedHost: String = ""
    private var cachedPort: Int = 0
    private var cachedAddr = sockaddr_in()
    private let queue = DispatchQueue(label: "com.handosc.native.osc", qos: .userInteractive)

    public init() {
        openSocket()
    }

    deinit {
        closeSocket()
    }

    private func openSocket() {
        socketFd = socket(AF_INET, SOCK_DGRAM, 0)
        if socketFd >= 0 {
            var opt: Int32 = 1
            setsockopt(socketFd, SOL_SOCKET, SO_REUSEADDR, &opt, socklen_t(MemoryLayout<Int32>.size))
            // Non-blocking mode
            let flags = fcntl(socketFd, F_GETFL, 0)
            if flags >= 0 {
                _ = fcntl(socketFd, F_SETFL, flags | O_NONBLOCK)
            }
        }
    }

    private func closeSocket() {
        if socketFd >= 0 {
            close(socketFd)
            socketFd = -1
        }
    }

    public func send(messages: [OSCMessage], host: String, port: Int, asBundle: Bool) {
        let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedHost.isEmpty, port >= 1, port <= 65535, !messages.isEmpty else { return }

        queue.async { [weak self] in
            guard let self else { return }
            if self.socketFd < 0 {
                self.openSocket()
            }
            guard self.socketFd >= 0 else { return }

            if self.cachedHost != trimmedHost || self.cachedPort != port {
                var sin = sockaddr_in()
                sin.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                sin.sin_family = sa_family_t(AF_INET)
                sin.sin_port = in_port_t(UInt16(port).bigEndian)
                if inet_pton(AF_INET, trimmedHost, &sin.sin_addr) == 1 {
                    self.cachedAddr = sin
                    self.cachedHost = trimmedHost
                    self.cachedPort = port
                } else {
                    return
                }
            }

            var destAddr = self.cachedAddr
            let addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)

            withUnsafePointer(to: &destAddr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                    if asBundle {
                        let packets = messages.map { Self.encodeMessage($0) }
                        var chunk: [Data] = []
                        var chunkBytes = 16 // "#bundle\0" + 8-byte timetag
                        for pkt in packets {
                            if chunkBytes + 4 + pkt.count > 14000, !chunk.isEmpty {
                                let bundleData = Self.encodeBundle(encodedMessages: chunk)
                                bundleData.withUnsafeBytes { raw in
                                    if let base = raw.baseAddress {
                                        _ = sendto(self.socketFd, base, raw.count, 0, sa, addrLen)
                                    }
                                }
                                chunk.removeAll(keepingCapacity: true)
                                chunkBytes = 16
                            }
                            chunk.append(pkt)
                            chunkBytes += 4 + pkt.count
                        }
                        if !chunk.isEmpty {
                            let bundleData = Self.encodeBundle(encodedMessages: chunk)
                            bundleData.withUnsafeBytes { raw in
                                if let base = raw.baseAddress {
                                    _ = sendto(self.socketFd, base, raw.count, 0, sa, addrLen)
                                }
                            }
                        }
                    } else {
                        for msg in messages {
                            let data = Self.encodeMessage(msg)
                            data.withUnsafeBytes { raw in
                                if let base = raw.baseAddress {
                                    _ = sendto(self.socketFd, base, raw.count, 0, sa, addrLen)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - OSC 1.0 Binary Encoding

    public static func encodeMessage(_ msg: OSCMessage) -> Data {
        var data = Data(capacity: 32 + msg.args.count * 4)
        appendOSCString(msg.address, to: &data)

        var typeTags = ","
        typeTags.reserveCapacity(1 + msg.args.count)
        for arg in msg.args {
            switch arg {
            case .float: typeTags.append("f")
            case .int: typeTags.append("i")
            case .string: typeTags.append("s")
            case .bool(let b): typeTags.append(b ? "T" : "F")
            }
        }
        appendOSCString(typeTags, to: &data)

        for arg in msg.args {
            switch arg {
            case .float(let f):
                var bits = f.bitPattern.bigEndian
                withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
            case .int(let i):
                var big = i.bigEndian
                withUnsafeBytes(of: &big) { data.append(contentsOf: $0) }
            case .string(let s):
                appendOSCString(s, to: &data)
            case .bool:
                break
            }
        }
        return data
    }

    public static func encodeBundle(encodedMessages: [Data]) -> Data {
        var totalSize = 16
        for m in encodedMessages { totalSize += 4 + m.count }
        var data = Data(capacity: totalSize)

        // "#bundle\0"
        appendOSCString("#bundle", to: &data)
        // Immediate NTP timetag (0x0000000000000001)
        var timetag: UInt64 = UInt64(1).bigEndian
        withUnsafeBytes(of: &timetag) { data.append(contentsOf: $0) }

        for m in encodedMessages {
            var len = Int32(m.count).bigEndian
            withUnsafeBytes(of: &len) { data.append(contentsOf: $0) }
            data.append(m)
        }
        return data
    }

    @inline(__always)
    private static func appendOSCString(_ string: String, to data: inout Data) {
        let utf8 = Array(string.utf8)
        data.append(contentsOf: utf8)
        let padCount = 4 - (utf8.count % 4)
        for _ in 0..<padCount {
            data.append(0)
        }
    }
}
