/**
 * CRC-16/CCITT nibble-based implementation.
 * Polynomial 0x1021, init 0x0000, processes 4 bits at a time.
 */

const CRC_TABLE: readonly number[] = [
  0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
  0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
];

export function crc16(data: Buffer | number[]): number {
  let crc = 0x0000;
  for (const byte of data) {
    // High nibble
    crc = ((crc << 4) & 0xffff) ^ CRC_TABLE[((crc >> 12) ^ (byte >> 4)) & 0x0f];
    // Low nibble
    crc = ((crc << 4) & 0xffff) ^ CRC_TABLE[((crc >> 12) ^ (byte & 0x0f)) & 0x0f];
  }
  return crc & 0xffff;
}
