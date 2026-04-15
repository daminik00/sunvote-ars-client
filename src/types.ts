export const BAUD_RATE = 19200;
export const HEADER = 0xf5;
export const SYS_CODE: [number, number] = [0xaa, 0xaa];

export enum CmdCode {
  System = 0x11,
  Scan = 0x15,
  SystemResp = 0x91,
  ScanResp = 0x95,
}

/**
 * Flag byte values for host→base Scan-command packets (at payload byte 3).
 * The high nibble 0xC0 marks the packet as a host→base session-management
 * command; the low nibble selects the specific operation.
 */
export enum ScanSubCmd {
  Start = 0xc1,
  /** Clear — follows Start in the vote-session activation sequence; purpose is to reset the base's session/RF buffer. */
  Clear = 0xc2,
  Stop = 0xc3,
  Poll = 0xc4,
  Ack = 0xc5,
  /** Base-config read uses low-nibble flags=0x00; value goes in the subCmd byte. */
  BaseScanRd = 0x06,
}

/** Post-Start vote "ready" sub-command (goes in the subCmd byte, not flags). */
export const SCAN_READY_SUBCMD = 0x02;

/**
 * Base-zone-write sub-command (0x05) — shares the value with the old Ack byte.
 * Goes in the subCmd byte of a Scan packet with flags=0x00.
 */
export const SCAN_BASE_ZONE_WR = 0x05;

export enum SystemSubCmd {
  KeypadWrite = 0x03,
  KeypadRead = 0x04,
  BaseIniWrite = 0x0b,
  IdlePoll = 0x0c,
}

export enum SessionState {
  Idle = 'idle',
  Connected = 'connected',
  Voting = 'voting',
}

/**
 * Button-code → label map for the 6-button bitmap keypad (PVS-W00 family,
 * including the W00E as used with base PVS-2010-433M).
 *
 * The hardware encodes button presses as one-hot bitmap bytes, not sequential
 * codes — confirmed by capturing all six presses from live hardware on
 * 2026-04-16: pressing "1" → 0x01, "2" → 0x02, "3" → 0x04, "4" → 0x08,
 * "5" → 0x10, "6" → 0x20. Unknown codes fall through to the hex fallback in
 * {@link SunVoteController}.
 */
export const BUTTON_LABELS: Map<number, string> = new Map([
  [0x01, '1/A'],
  [0x02, '2/B'],
  [0x04, '3/C'],
  [0x08, '4/D'],
  [0x10, '5/E'],
  [0x20, '6/F'],
]);

export interface BaseConfig {
  baseId: number;
  keyFrom: number;
  keyTo: number;
  keyMax: number;
  channel: number;
}

export interface KeypadPress {
  keypadId: number;
  button: number;
  buttonLabel: string;
  timestamp: number;
  /**
   * Raw per-keypad counter byte from the poll response slot (`payload[13]`).
   * Empirically observed to be a stable keypad identifier or a slow-moving
   * sequence byte — investigation ongoing. Exposed for apps that want to
   * implement their own dedup / repeat-press detection. May be `undefined`
   * on older SDK code paths; prefer inspecting {@link KeypadPress.button}
   * plus timestamps for normal use.
   */
  counter?: number;
}

export interface VoteOptions {
  mode?: number;
  options?: number;
  minSelections?: number;
  maxSelections?: number;
}

export interface ParsedPacket {
  cmd: number;
  payload: Buffer;
  crcValid: boolean;
  length: number;
}

export interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

export interface ConnectionOptions {
  path: string;
  baudRate?: number;
  /** When true, log all TX/RX packets and state transitions to console.debug(). */
  debug?: boolean;
}

export interface SunVoteEvents {
  /**
   * Deduplicated press — fires when the button *value* changes for a given
   * keypad. Ideal for "currently selected answer" UIs where the last press
   * wins. Two taps of the same button in a row collapse into one event;
   * subscribe to {@link keypad:click} instead if you need every tap.
   */
  'keypad:press': (press: KeypadPress) => void;
  /**
   * Every physical tap ("click") on a keypad, as reported by the base. No
   * dedup — tapping the same button twice in a row fires this event twice.
   * Use for voting counts, analytics, or any flow that needs per-tap
   * visibility.
   */
  'keypad:click': (press: KeypadPress) => void;
  'keypad:new': (keypadId: number) => void;
  'state:change': (newState: SessionState, oldState: SessionState) => void;
  'base:config': (config: BaseConfig) => void;
  error: (error: Error) => void;
}

export interface PollResult {
  entries: Array<{ keypadId: number; button: number; counter: number }>;
  ackByte: number;
}
