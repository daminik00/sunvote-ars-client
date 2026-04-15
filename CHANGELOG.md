# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
