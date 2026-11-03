# Nimvane

*Less weight. More web.*

A fast, lean, privacy-first desktop browser. It runs on Electron's Chromium engine, so real websites work, with a minimal custom interface on top.

## Run it

```bash
npm install
npm start
```

Requires Node 18+. Build installers with `npm run dist`. The app icon lives at `build/icon.png` (1024×1024).

On Linux, `npm run desktop` adds Nimvane to your app launcher so its icon shows in the taskbar when running from source (`npm run desktop -- --remove` undoes it). Run it again if you move the folder.

On Node 26 the Electron download can fail to unpack silently. If `npm start` says Electron failed to install, unpack it by hand:

```bash
unzip -oq ~/.cache/electron/*/electron-v33.4.11-linux-x64.zip -d node_modules/electron/dist && printf electron > node_modules/electron/path.txt
```

## Install

Build installers with `npm run dist:linux`, `npm run dist:win` or `npm run dist:mac`. They land in `dist/`.

| System | File | Installs to |
|---|---|---|
| Arch, CachyOS, Manjaro | `nimvane-<version>.pacman` | `/opt/Nimvane`, command `nimvane` |
| Debian, Ubuntu, Mint | `nimvane_<version>_amd64.deb` | `/opt/Nimvane`, command `nimvane` |
| Any Linux | `Nimvane-<version>.AppImage` | Nowhere. It runs as a single file. |
| Windows | `Nimvane Setup <version>.exe` | `%LOCALAPPDATA%\Programs\Nimvane` (just you) or `Program Files` (all users). Adds itself to Settings > Default apps. |
| macOS | `Nimvane-<version>.dmg` | `/Applications` (drag it in) |

```bash
sudo pacman -U dist/nimvane-1.0.0.pacman
```

Your profile (cookies, settings) lives outside the install folder, so updating or reinstalling keeps it. Linux and Windows installers build on Linux (Windows needs `wine`). The macOS one needs a Mac: push the project to GitHub and run the "Build installers" workflow, which builds all three. The installers aren't code-signed yet, so Windows SmartScreen and macOS Gatekeeper show a warning the first time.

If you used `npm run desktop` before installing, run `npm run desktop -- --remove` afterwards so the launcher uses the installed app.

## What makes it "optimized"

**Speed**
- GPU rasterization, zero-copy, and back/forward cache enabled
- Background networking, translate, media router, and other Chrome extras turned off
- Sandboxed renderers, no spellcheck overhead, tiny hand-written UI (no framework)

**Low memory**
- Tabs idle for 5 minutes are fully unloaded. They reload when you click them. Tabs playing audio or loading are never unloaded.

**Privacy**
- Ad and tracker requests are blocked by domain (`blocklist.txt`). The shield counter shows blocks per page.
- Tracking parameters (`utm_*`, `fbclid`, `gclid`, and others) are stripped from links
- Do Not Track and Global Privacy Control headers are sent
- Location, notifications and other permissions are denied. Camera and microphone ask first, and the answer lasts until you quit. Fullscreen and clipboard write are allowed.
- DuckDuckGo is the default search
- Links that belong to another app (`claude://`, `claude-cli://`, `mailto:`, and so on) ask before opening it, like Chrome's "Open Claude?" prompt. Tick "Always allow" to skip the prompt for that site until you quit.

**Usage widget**
- The memory badge in the toolbar shows what Nimvane uses right now. Click it (or press Shift+Esc) for a breakdown by tab and process, tips on what to trim, and buttons to sleep tabs.
- On Linux it reports PSS, which splits shared memory fairly. RSS, what Electron reports by default, roughly doubles the real total.

**Minimal UI**
- One row of tabs and one toolbar. Everything else is keyboard-driven.

## Shortcuts

| Action | Keys |
|---|---|
| New / close tab | Ctrl+T / Ctrl+W |
| Reopen closed tab | Ctrl+Shift+T |
| Resource usage | Shift+Esc |
| Address bar | Ctrl+L / F6 / Alt+D |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Jump to tab 1-8 / last | Ctrl+1..8 / Ctrl+9 |
| Back / forward | Alt+Left / Alt+Right |
| Reload / hard reload | Ctrl+R or F5 / Ctrl+Shift+R |
| Zoom | Ctrl+= / Ctrl+- / Ctrl+0 |
| DevTools | F12 |

On macOS use Cmd in place of Ctrl.

## Customize

- `main.js` top: `SUSPEND_AFTER_MS`, `ALLOWED_PERMISSIONS`, Chromium flags
- `util.js`: default search engine (`SEARCH`)
- Stronger blocking: put a hosts-format list (for example StevenBlack/hosts) in your user-data folder as `blocklist.txt`. It loads on top of the built-in list. Find the folder path with `app.getPath('userData')`.

## Tests

`npm test` checks the address-bar parser, tracking-parameter stripping, and the blocker.

## Ideas for next steps

Bookmarks, history, find-in-page, session restore, and a downloads manager.
