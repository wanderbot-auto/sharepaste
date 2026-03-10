# SharePaste macOS Desktop (Swift Native)

Native macOS status-bar app implemented with SwiftUI.

## Prerequisites

- macOS 13+
- Xcode 15+ (or Apple Swift toolchain with SwiftUI support)
- Node.js 20+
- Project dependencies installed at repo root (`npm install`)

## Run (development)

From repository root:

```bash
swift run --package-path apps/desktop-macos sharepaste-desktop
```

## Build (release)

```bash
swift build --package-path apps/desktop-macos -c release
```

The binary output is:

```bash
apps/desktop-macos/.build/release/sharepaste-desktop
```

## Notes

- The app currently bridges to the existing client CLI (`npm run -w @sharepaste/client dev -- ...`) for business operations.
- If the app is launched outside repository context, set `SHAREPASTE_REPO_ROOT` to the repository path.
- The app runs from the macOS menu bar (`MenuBarExtra`) and is hidden from the Dock (`accessory` activation policy).
- Manual "send payload" controls are removed; when auto-upload is enabled, clipboard text changes are uploaded automatically.
