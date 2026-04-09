# sunvote-ars-client

[![CI](https://github.com/daminik00/sunvote-ars-client/actions/workflows/ci.yml/badge.svg)](https://github.com/daminik00/sunvote-ars-client/actions)
[![npm version](https://img.shields.io/npm/v/sunvote-ars-client.svg)](https://www.npmjs.com/package/sunvote-ars-client)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Unofficial open-source TypeScript client for SunVote ARS (Audience Response System) hardware. Communicates with PVS-2010-433M wireless voting receivers via serial port.

> **Disclaimer:** This project is NOT affiliated with, endorsed by, or sponsored by Changsha SunVote Information Technology Co., Ltd. "SunVote" is a trademark of its respective owner. See [NOTICE](NOTICE) for details.

## Installation

```bash
npm install sunvote-ars-client
```

> **Note:** The `serialport` package is a dependency and requires native compilation. On some platforms you may need build tools installed (Python, C++ compiler).

## Quick Start

```ts
import { SunVoteController } from 'sunvote-ars-client';

const ctrl = new SunVoteController();
ctrl.on('keypad:press', (press) => console.log(press));
const config = await ctrl.autoConnect();
await ctrl.startVoting();
```

## API Reference

### `SunVoteController`

The main high-level class. Manages connection, voting sessions, and keypad event handling.

#### Constructor

```ts
new SunVoteController(options?: { pollInterval?: number })
```

- `pollInterval` -- Interval between keypad poll cycles in ms (default: `50`).

#### Properties

| Property | Type | Description |
|---|---|---|
| `currentState` | `SessionState` | Current state: `'idle'`, `'connected'`, or `'voting'`. |
| `config` | `BaseConfig \| null` | Base station config after connecting. |

#### Methods

##### `autoConnect(options?): Promise<BaseConfig>`

Find a SunVote receiver automatically via USB and connect to it.

```ts
const config = await ctrl.autoConnect({ baudRate: 19200, debug: true });
```

- `options.baudRate` -- Serial baud rate (default: `19200`).
- `options.debug` -- Log all TX/RX packets as hex to `console.debug()`.
- Throws if no receiver is found.

##### `connect(options): Promise<BaseConfig>`

Connect to a specific serial port.

```ts
const config = await ctrl.connect({ path: '/dev/ttyUSB0', debug: true });
```

- `options.path` -- Serial port path (required).
- `options.baudRate` -- Baud rate (default: `19200`).
- `options.debug` -- Enable debug logging.

##### `disconnect(): Promise<void>`

Disconnect from the receiver. Stops voting if active.

##### `startVoting(options?): Promise<void>`

Start a voting session and begin polling keypads.

```ts
await ctrl.startVoting({ options: 4, maxSelections: 1 });
```

- `options.mode` -- Voting mode (default: `0x05`).
- `options.options` -- Number of answer options (default: `2`).
- `options.minSelections` -- Minimum selections required (default: `1`).
- `options.maxSelections` -- Maximum selections allowed (default: `6`).

##### `stopVoting(): Promise<void>`

Stop the current voting session and halt polling.

##### `writeConfig(config): Promise<void>`

Write a new base station configuration. Must be connected and not voting.

##### `writeKeypadId(keypadId): Promise<void>`

Assign an ID to a keypad in programming mode.

##### `readKeypadId(): Promise<number | null>`

Read the ID from a keypad in programming mode.

##### `getKeypads(): Map<number, KeypadPress | null>`

Get a snapshot of all known keypads and their last button press. Keys are keypad IDs; values are the last `KeypadPress` object, or `null` if the keypad was detected but hasn't pressed a button yet.

##### `static listPorts(): Promise<PortInfo[]>`

List all serial ports on the system.

##### `static findPort(): Promise<string | null>`

Find the first FTDI-based (SunVote) serial port.

### Events

Subscribe to events with `ctrl.on(event, handler)`.

| Event | Payload | Description |
|---|---|---|
| `keypad:press` | `KeypadPress` | A keypad button was pressed (deduplicated). |
| `keypad:new` | `number` (keypadId) | A previously unseen keypad was detected. |
| `state:change` | `(newState, oldState)` | The session state changed. |
| `base:config` | `BaseConfig` | Base station config was read or written. |
| `error` | `Error` | An error occurred (poll failure, disconnect, etc.). |

### Types

#### `KeypadPress`

```ts
interface KeypadPress {
  keypadId: number;
  button: number;       // Raw button byte (0x01, 0x02, 0x04, 0x08, 0x10, 0x20)
  buttonLabel: string;  // Human-readable label ("1/A", "2/B", etc.)
  timestamp: number;    // Date.now() when the press was detected
}
```

#### `BaseConfig`

```ts
interface BaseConfig {
  baseId: number;
  keyFrom: number;
  keyTo: number;
  keyMax: number;
  channel: number;
}
```

#### `SessionState`

```ts
enum SessionState {
  Idle = 'idle',
  Connected = 'connected',
  Voting = 'voting',
}
```

### Low-Level API

For advanced usage, the SDK also exports:

- `SunVoteReceiver` -- Direct serial I/O wrapper.
- `buildShortPacket()` / `buildLongPacket()` -- Packet builders.
- `parsePacket()` / `extractPackets()` -- Packet parsers.
- `PacketAssembler` -- Incremental assembler for fragmented serial reads.
- `crc16()` -- CRC-16/CCITT implementation.
- `listPorts()` / `findSunVotePort()` -- Port discovery.

## Electron Integration

The SDK works in Electron's **main process** (it requires Node.js `serialport`).

```ts
// main.ts (Electron main process)
import { SunVoteController } from 'sunvote-ars-client';
import { ipcMain, BrowserWindow } from 'electron';

const ctrl = new SunVoteController();

ctrl.on('keypad:press', (press) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('keypad-press', press);
  });
});

ctrl.on('error', (err) => {
  console.error('SunVote error:', err.message);
});

ipcMain.handle('sunvote:connect', async () => {
  return ctrl.autoConnect({ debug: true });
});

ipcMain.handle('sunvote:start-voting', async () => {
  await ctrl.startVoting();
});

ipcMain.handle('sunvote:stop-voting', async () => {
  await ctrl.stopVoting();
});

ipcMain.handle('sunvote:disconnect', async () => {
  await ctrl.disconnect();
});

ipcMain.handle('sunvote:keypads', () => {
  return Object.fromEntries(ctrl.getKeypads());
});
```

```ts
// renderer (preload bridge)
const { ipcRenderer } = require('electron');

ipcRenderer.on('keypad-press', (_event, press) => {
  console.log('Keypad pressed:', press);
});

await ipcRenderer.invoke('sunvote:connect');
await ipcRenderer.invoke('sunvote:start-voting');
```

## Debug Mode

Pass `debug: true` to `connect()` or `autoConnect()` to enable verbose logging:

```
[sunvote] 2025-01-15T10:30:00.123Z Connecting to /dev/ttyUSB0
[sunvote] 2025-01-15T10:30:00.124Z Opening port /dev/ttyUSB0 @ 19200 baud
[sunvote] 2025-01-15T10:30:00.200Z TX: f5 aa aa 0c 11 00 00 0f 0c 00 00 00 00 00 7a d9
[sunvote] 2025-01-15T10:30:00.250Z RX raw: f5 aa aa 0c 91 01 ...
[sunvote] 2025-01-15T10:30:00.251Z State: idle -> connected
```

All debug output uses `console.debug()` prefixed with `[sunvote]` and ISO timestamps.

## Cross-Platform Notes

- **macOS**: Port paths look like `/dev/tty.usbserial-XXXX`. FTDI drivers are built into macOS 10.15+.
- **Linux**: Port paths look like `/dev/ttyUSB0`. You may need to add your user to the `dialout` group: `sudo usermod -aG dialout $USER`.
- **Windows**: Port paths look like `COM3`. FTDI drivers may need to be installed from [ftdichip.com](https://ftdichip.com/drivers/).

The SDK auto-detects SunVote receivers by looking for FTDI vendor ID `0403`.

## Contributing

Contributions are welcome! Please read the [contributing guidelines](.github/CONTRIBUTING.md) before opening a pull request.

## License

MIT -- see [LICENSE](LICENSE) for details.
