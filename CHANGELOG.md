# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-04-15

### Fixed
- **Voting sessions now actually reach the keypads.** The Scan-command flag byte for session-management packets was being sent as `0x01`/`0x03`/`0x04`/`0x05` instead of `0xC1`/`0xC3`/`0xC4`/`0xC5`. The high-nibble `0xC0` marks the packet as a host→base session command; without it the base acknowledged the "start vote" TX but never broadcast the wake command over RF, so keypads stayed asleep and polls always returned "empty slot" (`type=0xFF`).
- `startVoteSession` packet `arg1` is now `baseId` (matching `stopVoteSession` / `pollKeypads`) instead of hardcoded `0x01`.

### Changed
- `ScanSubCmd` enum values updated to the correct host→base flag bytes (`0xC1`/`0xC3`/`0xC4`/`0xC5`). `BaseScanRd = 0x06` is unchanged (lives in the subCmd byte, not flags).
- New `SCAN_READY_SUBCMD = 0x02` constant for the vote-session "ready" sub-command byte.

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
