# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-04-16

First release validated end-to-end against live PVS-2010-433M + PVS-W00
keypad hardware. Every protocol fix below was confirmed by watching real
button presses arrive with the correct codes. Supersedes 1.1.1, which
reached npm with only a partial subset of these fixes — always prefer 1.1.2.

## [1.1.1] - 2026-04-15 — partial, superseded by 1.1.2

Shipped to npm prematurely from an intermediate commit that contained only
the `0xCX` Scan-flag-byte rename. Missing from this release (and present in
1.1.2): the 5-packet `startVoteSession` activation sequence (without which
keypads stay asleep), the `pollKeypads` timing/batching rewrite, and the
`writeBaseConfig` byte-layout fix (channel was silently overwritten by
`keyTo`). **Use 1.1.2 or newer.**

### Fixed
- **Voting sessions now actually reach the keypads.** The Scan-command flag byte for session-management packets was being sent as `0x01`/`0x03`/`0x04`/`0x05` instead of `0xC1`/`0xC3`/`0xC4`/`0xC5`. Without the host→base `0xC0` high-nibble, the base ACK'd our "start vote" TX but never broadcast the RF wake command, so keypads stayed asleep and polls always returned "empty slot" (`type=0xFF`).
- **Voting sessions now include the full 5-packet activation sequence.** Previously only C1 (Start scan) was sent; the captured reference implementation also sends C2 (clear), C4 (initial poll), and two C5 long-packet broadcasts (targeted + `arg1=0xC7` with a 50 ms inter-packet gap). The final C5 is the RF wake signal — without it keypads never come out of sleep even though the base's `startVoteSession` was ACK'd.
- **`pollKeypads` now mirrors the reference Python timing.** Flush the port, fire C5-ACK + C5-broadcast + C4-poll in rapid succession with 20 ms gaps, then read any response for 400 ms. The previous per-packet `sendAndReceive` loop with individual 100 ms timeouts desynced the base's response batching on the observed firmware revision.
- **`writeBaseConfig` no longer corrupts the base's channel.** The BaseIniWr data is `[baseId, keyFrom, channel, 0, 0]`, not `[baseId, keyFrom, keyTo, channel, 0]` — including `keyTo` here pushed `channel` into a byte the base discards and silently stored the clamped `keyTo` as the new channel. The keypad range is already written in the separate BaseZoneWr packet (16-bit encoded).
- `startVoteSession` packet `arg1` is now `baseId` (matching `stopVoteSession` / `pollKeypads`) instead of the previously hardcoded `0x01`.

### Changed
- `ScanSubCmd` enum values updated to the correct host→base flag bytes (`Start=0xC1`, `Stop=0xC3`, `Poll=0xC4`, `Ack=0xC5`) plus a new `Clear=0xC2`. `BaseScanRd = 0x06` is unchanged (lives in the subCmd byte, not flags).
- New `SCAN_READY_SUBCMD = 0x02` constant for the vote-session "ready" sub-command byte (now also exported from the package root).
- `BUTTON_LABELS` confirmed as 6-button one-hot bitmap mapping (`0x01`→`1/A`, `0x02`→`2/B`, `0x04`→`3/C`, `0x08`→`4/D`, `0x10`→`5/E`, `0x20`→`6/F`) — validated by pressing every button on four different PVS-W00 keypads against the base. This was the original mapping; the short-lived "sequential" mapping experiment added during debugging has been fully reverted.
- Demo Electron app expanded to exercise every public SDK surface:
  - Port picker backed by `listPorts()` (with refresh button and vendor hints).
  - `connect({ path })` in addition to `autoConnect()`.
  - Editable base-config section with `writeConfig()`.
  - Keypad-programming section with `readKeypadId()` / `writeKeypadId()`.
  - Voting-parameter defaults changed to `options=2, min=1, max=6` (the known-good values from the captured SunVoteARS PowerPoint add-in session). With `maxSelections=1` the base has been observed to return obfuscated button codes on this hardware — the README now calls this out.
- README: rewritten `startVoting()` example to showcase the defaults and flagged the `maxSelections=1` obfuscation caveat.

### Developer tooling
- Switched demo workspace to a `file:..` dependency so `node_modules/sunvote-ars-client` symlinks to the repo root — previous `"*"` declaration caused npm to fetch a stale copy from the registry, which silently shadowed local SDK rebuilds during development.

## [1.1.0] - 2026-04-15

### Added
- `getDriverInstallInfo(status)` — returns end-user-facing instructions and download URL based on a `DriverStatus`.
- `openDriverDownloadPage(url?)` — opens the official FTDI driver download page in the system's default browser (cross-platform).
- `FTDI_DRIVER_DOWNLOAD_PAGE` constant — official FTDI VCP/CDM driver landing page URL.
- `DriverStatus.downloadUrl` field — explicit, machine-readable URL when manual driver install is required (`null` when not needed).
- `DriverInstallInfo` type.
- `demo/` workspace — a minimal Electron demo app exercising every SDK feature (driver check, auto-connect, config readout, voting, live keypad table, activity log). Runs via `npm run demo` from the repo root; not published to npm.
- README: new "Driver Setup" and "Demo App" sections.

### Changed
- `checkDriver()` now reports that Windows 10/11 typically installs FTDI drivers automatically via Windows Update.
- `installDriver(driverDir)` JSDoc: clarified the function is intended for hardware distributors who have the right to bundle FTDI drivers; general apps should use `openDriverDownloadPage()` instead.
- README: license footer corrected from MIT to Apache-2.0.

### Removed
- `drivers/` directory — bundled FTDI driver files have been removed from the repository to comply with FTDI's CDM Driver License (§3.1.7), which prohibits redistribution by anyone other than hardware sellers/distributors.

## [1.0.3] - 2026-04-15

### Fixed
- CI: switch publish workflow to Node 24 (bundles npm 11+ with native OIDC support for Trusted Publishing)

## [1.0.0] - 2025-04-09

### Added

- `SunVoteController` high-level API with auto-connect, voting sessions, and keypad event handling.
- `SunVoteReceiver` low-level serial I/O wrapper.
- Packet builders (`buildShortPacket`, `buildLongPacket`) and parsers (`parsePacket`, `extractPackets`, `PacketAssembler`).
- CRC-16/CCITT implementation (`crc16`).
- USB port auto-detection for FTDI-based SunVote receivers.
- Driver status checking and installation helpers for Windows (`checkDriver`, `installDriver`).
- Full TypeScript type definitions and source maps.
- Dual CJS/ESM package output.
- Comprehensive API documentation in README.
