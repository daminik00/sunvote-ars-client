# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-15

### Added
- `getDriverInstallInfo(status)` — returns end-user-facing instructions and download URL based on a `DriverStatus`.
- `openDriverDownloadPage(url?)` — opens the official FTDI driver download page in the system's default browser (cross-platform).
- `FTDI_DRIVER_DOWNLOAD_PAGE` constant — official FTDI VCP/CDM driver landing page URL.
- `DriverStatus.downloadUrl` field — explicit, machine-readable URL when manual driver install is required (`null` when not needed).
- `DriverInstallInfo` type.
- README: new "Driver Setup" section explaining the zero-bundle approach and how to guide end-users through driver setup.

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
