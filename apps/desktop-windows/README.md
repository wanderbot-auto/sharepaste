# desktop-windows

Planned Windows desktop client shell.

Suggested direction:

- Keep platform windowing, tray integration, auto-start, and installer logic here.
- Reuse shared client behavior from `packages/client-core` once extracted.
- Avoid duplicating protocol or crypto logic inside the shell.
