# SharePaste Windows Desktop (Tauri)

Native Windows desktop shell for SharePaste, built as a Tauri app with:

- a static TypeScript-free web UI layer served from `web/`
- a Rust backend for tray, window lifecycle, and native clipboard access
- a Node runtime bridge that reuses `@sharepaste/client` business logic

## Current scope

- full desktop window for init, recovery, devices, policy, pairing, sync status, and activity
- tray-first behavior: closing the main window hides to tray instead of quitting
- clipboard polling for text and image changes on Windows
- incoming text/image application back into the Windows clipboard

## Run (development)

From repository root:

```bash
npm run desktop:windows:dev
```

One-click launch on Windows:

```powershell
.\scripts\start-windows-client.cmd
```

The launcher auto-loads the MSVC developer environment from Visual Studio / Build Tools when needed, so `link.exe` does not need to already be on `PATH`.
You still need the Visual C++ toolchain and the Windows 10/11 SDK installed through Visual Studio Installer.

PowerShell entrypoint with optional overrides:

```powershell
.\scripts\start-windows-client.ps1 -Server 127.0.0.1:50052 -DeviceName "My Windows PC"
```

The Rust backend expects the repo to contain installed Node dependencies and will spawn:

```bash
npm run --silent -w @sharepaste/client dev:bridge -- ...
```

If the app is launched outside repository context, set:

```bash
SHAREPASTE_REPO_ROOT=<absolute repo path>
```

## Build (release)

```bash
npm run desktop:windows:build
```

Regenerate the committed desktop and web icon pack:

```bash
npm run desktop:windows:icons
```

## Notes

- The first implementation prioritizes local development over installer/signing work.
- The backend uses a native clipboard path for text/image reads and writes.
- File transfers still follow the existing client semantics: received files are materialized to disk and surfaced in the activity feed.
