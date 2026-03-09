// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SharePasteDesktop",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "sharepaste-desktop", targets: ["SharePasteDesktop"])
    ],
    targets: [
        .executableTarget(
            name: "SharePasteDesktop",
            path: "Sources"
        )
    ]
)
