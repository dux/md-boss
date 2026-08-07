// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MdBoss",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "MdBoss",
            targets: ["MdBoss"]
        )
    ],
    targets: [
        .executableTarget(
            name: "MdBoss",
            path: "app",
            exclude: ["Info.plist"],
            resources: [
                // .copy, never .process — the vendored JS must land byte-identical.
                .copy("Resources/marked.min.js"),
                .copy("Resources/highlight.min.js"),
                .copy("Resources/preview.js"),
                .copy("Resources/preview.css"),
                .copy("Resources/AppIcon.icns"),
                .copy("Resources/AppIcon.svg"),
                .copy("Resources/build-commit.txt")
            ]
        ),
        .testTarget(
            name: "MdBossTests",
            dependencies: ["MdBoss"],
            path: "Tests"
        )
    ]
)
