#!/usr/bin/env python3
"""Build SharePaste Windows desktop and web icon assets from SVG sources."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DESIGN_DIR = ROOT / "apps" / "desktop-windows" / "design"
TAURI_ICON_DIR = ROOT / "apps" / "desktop-windows" / "src-tauri" / "icons"
WEB_DIR = ROOT / "apps" / "desktop-windows" / "web"
WEB_ICON_DIR = WEB_DIR / "icons"

EDGE_CANDIDATES = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
]


def find_edge() -> Path:
    edge_on_path = shutil.which("msedge")
    if edge_on_path:
        return Path(edge_on_path)

    for candidate in EDGE_CANDIDATES:
        if candidate.is_file():
            return candidate

    raise FileNotFoundError("Microsoft Edge was not found. Install Edge to export icons.")


def write_wrapper(svg_path: Path, wrapper_path: Path) -> None:
    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {{
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
    }}
    img {{
      width: 100vw;
      height: 100vh;
      display: block;
    }}
  </style>
</head>
<body>
  <img src="{svg_path.resolve().as_uri()}" alt="">
</body>
</html>
"""
    wrapper_path.write_text(html, encoding="utf-8")


def render_png(edge_path: Path, svg_path: Path, output_path: Path, size: int) -> None:
    with tempfile.TemporaryDirectory(prefix="sharepaste-icon-") as temp_dir:
        wrapper_path = Path(temp_dir) / "render.html"
        write_wrapper(svg_path, wrapper_path)
        command = [
            str(edge_path),
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--allow-file-access-from-files",
            "--default-background-color=00000000",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=1000",
            "--log-level=3",
            f"--window-size={size},{size}",
            f"--screenshot={output_path}",
            wrapper_path.resolve().as_uri(),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(f"Edge export failed for {output_path.name}: {detail}")
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise RuntimeError(f"Edge did not create {output_path}")


def write_ico(output_path: Path, png_paths: list[Path]) -> None:
    payloads = [path.read_bytes() for path in png_paths]
    header = bytearray()
    header.extend((0).to_bytes(2, "little"))
    header.extend((1).to_bytes(2, "little"))
    header.extend(len(payloads).to_bytes(2, "little"))

    directory = bytearray()
    offset = 6 + (16 * len(payloads))

    for path, payload in zip(png_paths, payloads):
        size = int(path.stem.split("-")[-1])
        directory.extend((0 if size >= 256 else size).to_bytes(1, "little"))
        directory.extend((0 if size >= 256 else size).to_bytes(1, "little"))
        directory.extend((0).to_bytes(1, "little"))
        directory.extend((0).to_bytes(1, "little"))
        directory.extend((1).to_bytes(2, "little"))
        directory.extend((32).to_bytes(2, "little"))
        directory.extend(len(payload).to_bytes(4, "little"))
        directory.extend(offset.to_bytes(4, "little"))
        offset += len(payload)

    with output_path.open("wb") as handle:
        handle.write(header)
        handle.write(directory)
        for payload in payloads:
            handle.write(payload)


def export_many(edge_path: Path, svg_path: Path, outputs: dict[Path, int]) -> list[Path]:
    paths: list[Path] = []
    for output_path, size in outputs.items():
        output_path.parent.mkdir(parents=True, exist_ok=True)
        render_png(edge_path, svg_path, output_path, size)
        print(f"wrote {output_path.relative_to(ROOT)}")
        paths.append(output_path)
    return paths


def write_manifest() -> None:
    manifest = {
        "name": "SharePaste Windows",
        "short_name": "SharePaste",
        "description": "Desktop-first clipboard sync across your devices.",
        "display": "standalone",
        "background_color": "#0b2435",
        "theme_color": "#0d6f64",
        "icons": [
            {
                "src": "./icons/icon-192.png",
                "sizes": "192x192",
                "type": "image/png",
            },
            {
                "src": "./icons/icon-512.png",
                "sizes": "512x512",
                "type": "image/png",
            },
            {
                "src": "./icons/icon-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
    }
    (WEB_DIR / "site.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {(WEB_DIR / 'site.webmanifest').relative_to(ROOT)}")


def write_browserconfig() -> None:
    browserconfig = """<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="./icons/mstile-150.png" />
      <TileColor>#0b2435</TileColor>
    </tile>
  </msapplication>
</browserconfig>
"""
    (WEB_DIR / "browserconfig.xml").write_text(browserconfig, encoding="utf-8")
    print(f"wrote {(WEB_DIR / 'browserconfig.xml').relative_to(ROOT)}")


def copy_svg(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    print(f"wrote {target.relative_to(ROOT)}")


def main() -> int:
    edge_path = find_edge()

    app_svg = DESIGN_DIR / "sharepaste-app-icon.svg"
    favicon_svg = DESIGN_DIR / "sharepaste-favicon.svg"
    tray_svg = DESIGN_DIR / "sharepaste-tray-icon.svg"

    for source in (app_svg, favicon_svg, tray_svg):
        if not source.is_file():
            raise FileNotFoundError(f"Source SVG not found: {source}")

    TAURI_ICON_DIR.mkdir(parents=True, exist_ok=True)
    WEB_ICON_DIR.mkdir(parents=True, exist_ok=True)

    export_many(
        edge_path,
        app_svg,
        {
            TAURI_ICON_DIR / "icon.png": 256,
            WEB_ICON_DIR / "icon-192.png": 192,
            WEB_ICON_DIR / "icon-512.png": 512,
            WEB_ICON_DIR / "apple-touch-icon.png": 180,
            WEB_ICON_DIR / "mstile-150.png": 150,
        },
    )
    export_many(edge_path, tray_svg, {TAURI_ICON_DIR / "tray.png": 32})
    export_many(
        edge_path,
        favicon_svg,
        {
            WEB_ICON_DIR / "favicon-16.png": 16,
            WEB_ICON_DIR / "favicon-32.png": 32,
        },
    )

    with tempfile.TemporaryDirectory(prefix="sharepaste-ico-") as temp_dir:
        temp_root = Path(temp_dir)
        app_ico_pngs = []
        for size in (16, 32, 48, 64, 128, 256):
            png_path = temp_root / f"icon-{size}.png"
            render_png(edge_path, app_svg, png_path, size)
            app_ico_pngs.append(png_path)
        write_ico(TAURI_ICON_DIR / "icon.ico", app_ico_pngs)
        print(f"wrote {(TAURI_ICON_DIR / 'icon.ico').relative_to(ROOT)}")

        favicon_ico_pngs = []
        for size in (16, 32, 48):
            png_path = temp_root / f"favicon-{size}.png"
            render_png(edge_path, favicon_svg, png_path, size)
            favicon_ico_pngs.append(png_path)
        write_ico(WEB_ICON_DIR / "favicon.ico", favicon_ico_pngs)
        print(f"wrote {(WEB_ICON_DIR / 'favicon.ico').relative_to(ROOT)}")

    copy_svg(app_svg, WEB_ICON_DIR / "icon.svg")
    copy_svg(favicon_svg, WEB_ICON_DIR / "favicon.svg")
    write_manifest()
    write_browserconfig()
    return 0


if __name__ == "__main__":
    sys.exit(main())
