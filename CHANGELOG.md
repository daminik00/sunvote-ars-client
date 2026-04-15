# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-04-15

### Fixed
- CI: upgrade to latest npm in publish workflow so Trusted Publishing OIDC auth works (npm <11.5 lacks native OIDC token exchange)

## [1.0.1] - 2026-04-15

### Changed
- Verify end-to-end automated publishing pipeline via GitHub Release → Actions → npm Trusted Publishing (failed: npm bundled with Node 22 lacks OIDC publish support)

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
