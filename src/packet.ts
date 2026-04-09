import { crc16 } from './crc.js';
import { HEADER, SYS_CODE } from './types.js';
import type { ParsedPacket } from './types.js';

/** Short packet: 16 bytes total, LEN=0x0C */
const SHORT_LEN = 0x0c;
/** Long packet: 29 bytes total, LEN=0x19 */
const LONG_LEN = 0x19;

/**
 * Build a short (16-byte) packet.
 * Payload layout: [cmd, b5, b6, flags, subCmd, ...data(5 bytes)]
 * Total: F5 AA AA 0C <10 payload bytes> CRC_H CRC_L = 16 bytes
 */
export function buildShortPacket(
  cmd: number,
  b5: number,
  b6: number,
  flags: number,
  subCmd: number,
  data?: Buffer | number[],
): Buffer {
  const payload = Buffer.alloc(SHORT_LEN - 2); // 10 bytes payload
  payload[0] = cmd;
  payload[1] = b5;
  payload[2] = b6;
  payload[3] = flags;
  payload[4] = subCmd;

  if (data) {
    const src = Buffer.isBuffer(data) ? data : Buffer.from(data);
    src.copy(payload, 5, 0, Math.min(src.length, 5));
  }

  const crc = crc16(payload);
  const packet = Buffer.alloc(4 + SHORT_LEN); // 16 bytes
  packet[0] = HEADER;
  packet[1] = SYS_CODE[0];
  packet[2] = SYS_CODE[1];
  packet[3] = SHORT_LEN;
  payload.copy(packet, 4);
  packet[14] = (crc >> 8) & 0xff;
  packet[15] = crc & 0xff;

  return packet;
}

/**
 * Build a long (29-byte) packet.
 * Payload layout: [cmd, b5, b6, flags, ...data(19 bytes)]
 * Total: F5 AA AA 19 <23 payload bytes> CRC_H CRC_L = 29 bytes
 */
export function buildLongPacket(
  cmd: number,
  b5: number,
  b6: number,
  flags: number,
  data?: Buffer | number[],
): Buffer {
  const payload = Buffer.alloc(LONG_LEN - 2); // 23 bytes payload
  payload[0] = cmd;
  payload[1] = b5;
  payload[2] = b6;
  payload[3] = flags;

  if (data) {
    const src = Buffer.isBuffer(data) ? data : Buffer.from(data);
    src.copy(payload, 4, 0, Math.min(src.length, 19));
  }

  const crc = crc16(payload);
  const packet = Buffer.alloc(4 + LONG_LEN); // 29 bytes
  packet[0] = HEADER;
  packet[1] = SYS_CODE[0];
  packet[2] = SYS_CODE[1];
  packet[3] = LONG_LEN;
  payload.copy(packet, 4);
  packet[27] = (crc >> 8) & 0xff;
  packet[28] = crc & 0xff;

  return packet;
}

/**
 * Parse a single raw packet buffer into a ParsedPacket.
 * Expects buffer starting with F5 AA AA LEN ...
 */
export function parsePacket(raw: Buffer): ParsedPacket | null {
  if (raw.length < 6) return null;
  if (raw[0] !== HEADER || raw[1] !== SYS_CODE[0] || raw[2] !== SYS_CODE[1]) return null;

  const len = raw[3];
  const totalSize = 4 + len;
  if (raw.length < totalSize) return null;

  const payloadSize = len - 2;
  if (payloadSize < 1) return null;

  const payload = raw.subarray(4, 4 + payloadSize);
  const crcHi = raw[4 + payloadSize];
  const crcLo = raw[4 + payloadSize + 1];
  const receivedCrc = (crcHi << 8) | crcLo;
  const computedCrc = crc16(payload);

  return {
    cmd: payload[0],
    payload: Buffer.from(payload),
    crcValid: receivedCrc === computedCrc,
    length: totalSize,
  };
}

/**
 * Extract all complete packets from a buffer (e.g., accumulated serial data).
 */
export function extractPackets(data: Buffer): ParsedPacket[] {
  const packets: ParsedPacket[] = [];
  let offset = 0;

  while (offset < data.length) {
    // Scan for header byte
    const headerIdx = data.indexOf(HEADER, offset);
    if (headerIdx === -1) break;

    // Need at least 4 bytes for header + syscode + len
    if (headerIdx + 4 > data.length) break;

    // Validate sys code
    if (data[headerIdx + 1] !== SYS_CODE[0] || data[headerIdx + 2] !== SYS_CODE[1]) {
      offset = headerIdx + 1;
      continue;
    }

    const len = data[headerIdx + 3];
    const totalSize = 4 + len;

    if (headerIdx + totalSize > data.length) break;

    const packetBuf = data.subarray(headerIdx, headerIdx + totalSize);
    const parsed = parsePacket(packetBuf);
    if (parsed) {
      packets.push(parsed);
    }
    offset = headerIdx + totalSize;
  }

  return packets;
}

/**
 * Incremental packet assembler for fragmented serial reads.
 * Feed arbitrary chunks of data and receive complete parsed packets.
 */
export class PacketAssembler {
  private buffer: Buffer = Buffer.alloc(0);

  /** Feed a chunk of serial data and return any complete packets found. */
  feed(chunk: Buffer): ParsedPacket[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const packets: ParsedPacket[] = [];
    let consumed = 0;

    while (consumed < this.buffer.length) {
      const headerIdx = this.buffer.indexOf(HEADER, consumed);
      if (headerIdx === -1) {
        consumed = this.buffer.length;
        break;
      }

      // Skip junk before header
      if (headerIdx > consumed) {
        consumed = headerIdx;
      }

      // Need at least 4 bytes for header
      if (consumed + 4 > this.buffer.length) break;

      // Validate sys code
      if (
        this.buffer[consumed + 1] !== SYS_CODE[0] ||
        this.buffer[consumed + 2] !== SYS_CODE[1]
      ) {
        consumed += 1;
        continue;
      }

      const len = this.buffer[consumed + 3];
      const totalSize = 4 + len;

      // Wait for more data if incomplete
      if (consumed + totalSize > this.buffer.length) break;

      const packetBuf = this.buffer.subarray(consumed, consumed + totalSize);
      const parsed = parsePacket(packetBuf);
      if (parsed) {
        packets.push(parsed);
      }
      consumed += totalSize;
    }

    // Keep unconsumed data
    if (consumed > 0) {
      this.buffer = Buffer.from(this.buffer.subarray(consumed));
    }

    return packets;
  }

  /** Reset internal buffer. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  /** Current buffer length (bytes waiting). */
  get pending(): number {
    return this.buffer.length;
  }
}
