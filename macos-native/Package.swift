// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HandOSCNative",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "HandOSCNative", targets: ["HandOSCNative"])
    ],
    targets: [
        .executableTarget(
            name: "HandOSCNative",
            path: "Sources/HandOSCNative"
        )
    ]
)
