# sunvote-ars-client demo

Minimal Electron app that demonstrates every feature exposed by the SDK:

- `checkDriver()` / `getDriverInstallInfo()` / `openDriverDownloadPage()`
- `SunVoteController.listPorts()` — port picker with vendor/manufacturer hints
- `SunVoteController.autoConnect()` / `connect({path})` / `disconnect()`
- Base config readout (baseId, channel, key range) and `writeConfig()` with editable fields
- `writeKeypadId()` / `readKeypadId()` — keypad-programming flow for keypads in programming mode
- `startVoting()` / `stopVoting()` with configurable options
- Live keypad list with last-press indicators
- Activity log for state changes, events, and errors

## Running

From the **repository root** (not from inside `demo/`):

```bash
npm install           # installs root + workspace deps (demo is a workspace)
npm run demo          # builds the SDK and starts the Electron app
```

That's it. The demo references the SDK as an npm workspace, so any changes to
the SDK source take effect after `npm run build` in the root (or simply
re-running `npm run demo`).

## This demo is not published

It lives inside the repository as a `demo/` workspace for development and
marketing purposes, but the published `sunvote-ars-client` npm tarball only
ships the `dist/` build output (see the `files` field in the root
`package.json`). The demo directory is never part of a release.

## Packaging a standalone distributable (optional)

This repo intentionally does not ship a packaged `.dmg` / `.exe` / `.AppImage`
of the demo because driver redistribution differs per target platform and per
hardware distributor. If you want to build an installer for internal testing,
add `electron-builder` or `electron-forge` to this workspace and wire it to the
existing `main.js` / `preload.js` / `index.html` entry points.
