export const BAUD_RATE = 19200;
export const HEADER = 0xf5;
export const SYS_CODE: [number, number] = [0xaa, 0xaa];

export enum CmdCode {
  System = 0x11,
  Scan = 0x15,
  SystemResp = 0x91,
  ScanResp = 0x95,
}

export enum ScanSubCmd {
  Start = 0x01,
  Ready = 0x02,
  Stop = 0x03,
  Poll = 0x04,
  Ack = 0x05,
  BaseScanRd = 0x06,
}

/**
 * Alias for the BaseZoneWr sub-command, which shares the same value (0x05) as ScanSubCmd.Ack.
 * Kept as a standalone constant to avoid TypeScript enum value conflicts.
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
  'keypad:press': (press: KeypadPress) => void;
  'keypad:new': (keypadId: number) => void;
  'state:change': (newState: SessionState, oldState: SessionState) => void;
  'base:config': (config: BaseConfig) => void;
  error: (error: Error) => void;
}

export interface PollResult {
  entries: Array<{ keypadId: number; button: number }>;
  ackByte: number;
}
