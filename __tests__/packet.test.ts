import { describe, it, expect } from 'vitest';
import {
  buildShortPacket,
  buildLongPacket,
  parsePacket,
  extractPackets,
  PacketAssembler,
} from '../src/packet.js';
import { HEADER, SYS_CODE } from '../src/types.js';

describe('buildShortPacket', () => {
  it('should build a 16-byte packet', () => {
    const pkt = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    expect(pkt.length).toBe(16);
    expect(pkt[0]).toBe(HEADER);
    expect(pkt[1]).toBe(SYS_CODE[0]);
    expect(pkt[2]).toBe(SYS_CODE[1]);
    expect(pkt[3]).toBe(0x0c); // LEN
    expect(pkt[4]).toBe(0x11); // cmd
  });

  it('should include correct CRC', () => {
    const pkt = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    // CRC for this payload is 0x7AD9
    expect(pkt[14]).toBe(0x7a);
    expect(pkt[15]).toBe(0xd9);
  });

  it('should include data bytes', () => {
    const pkt = buildShortPacket(0x15, 0x01, 0x00, 0xc1, 0x02, [0x05, 0x02, 0x06, 0x01, 0x00]);
    expect(pkt[9]).toBe(0x05);
    expect(pkt[10]).toBe(0x02);
    expect(pkt[11]).toBe(0x06);
    expect(pkt[12]).toBe(0x01);
    expect(pkt[13]).toBe(0x00);
    // CRC should be 0xB75F
    expect(pkt[14]).toBe(0xb7);
    expect(pkt[15]).toBe(0x5f);
  });
});

describe('buildLongPacket', () => {
  it('should build a 29-byte packet', () => {
    const pkt = buildLongPacket(0x15, 0x01, 0x00, 0x05);
    expect(pkt.length).toBe(29);
    expect(pkt[0]).toBe(HEADER);
    expect(pkt[3]).toBe(0x19); // LEN
    expect(pkt[4]).toBe(0x15); // cmd
  });
});

describe('parsePacket', () => {
  it('should parse a valid short packet', () => {
    const pkt = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    const parsed = parsePacket(pkt);
    expect(parsed).not.toBeNull();
    expect(parsed!.cmd).toBe(0x11);
    expect(parsed!.crcValid).toBe(true);
    expect(parsed!.length).toBe(16);
    expect(parsed!.payload.length).toBe(10); // LEN(12) - 2
  });

  it('should parse a valid long packet', () => {
    const pkt = buildLongPacket(0x15, 0xc7, 0x00, 0x05);
    const parsed = parsePacket(pkt);
    expect(parsed).not.toBeNull();
    expect(parsed!.cmd).toBe(0x15);
    expect(parsed!.crcValid).toBe(true);
    expect(parsed!.length).toBe(29);
  });

  it('should detect invalid CRC', () => {
    const pkt = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    pkt[14] = 0x00; // corrupt CRC
    pkt[15] = 0x00;
    const parsed = parsePacket(pkt);
    expect(parsed).not.toBeNull();
    expect(parsed!.crcValid).toBe(false);
  });

  it('should return null for too-short data', () => {
    expect(parsePacket(Buffer.from([0xf5, 0xaa]))).toBeNull();
  });

  it('should return null for wrong header', () => {
    expect(parsePacket(Buffer.from([0x00, 0xaa, 0xaa, 0x0c, 0x00, 0x00]))).toBeNull();
  });

  it('should round-trip build and parse', () => {
    const pkt = buildShortPacket(0x15, 0x01, 0x00, 0x04, 0x00, [0x00, 0x00, 0x00, 0x00, 0x00]);
    const parsed = parsePacket(pkt);
    expect(parsed).not.toBeNull();
    expect(parsed!.cmd).toBe(0x15);
    expect(parsed!.crcValid).toBe(true);
    expect(parsed!.payload[1]).toBe(0x01);
    expect(parsed!.payload[3]).toBe(0x04);
  });
});

describe('extractPackets', () => {
  it('should extract multiple packets from concatenated data', () => {
    const pkt1 = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    const pkt2 = buildLongPacket(0x15, 0x01, 0x00, 0x05);
    const combined = Buffer.concat([pkt1, pkt2]);
    const packets = extractPackets(combined);
    expect(packets.length).toBe(2);
    expect(packets[0].cmd).toBe(0x11);
    expect(packets[1].cmd).toBe(0x15);
  });

  it('should skip junk bytes before a valid packet', () => {
    const junk = Buffer.from([0x00, 0x01, 0x02]);
    const pkt = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    const data = Buffer.concat([junk, pkt]);
    const packets = extractPackets(data);
    expect(packets.length).toBe(1);
    expect(packets[0].cmd).toBe(0x11);
  });
});

describe('PacketAssembler', () => {
  it('should assemble a packet from multiple chunks', () => {
    const pkt = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    const assembler = new PacketAssembler();

    // Feed first 8 bytes
    let result = assembler.feed(pkt.subarray(0, 8));
    expect(result.length).toBe(0);

    // Feed remaining bytes
    result = assembler.feed(pkt.subarray(8));
    expect(result.length).toBe(1);
    expect(result[0].cmd).toBe(0x11);
    expect(result[0].crcValid).toBe(true);
  });

  it('should handle multiple packets across chunks', () => {
    const pkt1 = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    const pkt2 = buildShortPacket(0x15, 0x01, 0x00, 0x04, 0x00);
    const combined = Buffer.concat([pkt1, pkt2]);
    const assembler = new PacketAssembler();

    // Feed in 3 chunks
    const chunk1 = combined.subarray(0, 10);
    const chunk2 = combined.subarray(10, 20);
    const chunk3 = combined.subarray(20);

    let packets = assembler.feed(chunk1);
    expect(packets.length).toBe(0);

    packets = assembler.feed(chunk2);
    expect(packets.length).toBe(1);
    expect(packets[0].cmd).toBe(0x11);

    packets = assembler.feed(chunk3);
    expect(packets.length).toBe(1);
    expect(packets[0].cmd).toBe(0x15);
  });

  it('should reset buffer on reset()', () => {
    const assembler = new PacketAssembler();
    assembler.feed(Buffer.from([0xf5, 0xaa, 0xaa]));
    expect(assembler.pending).toBeGreaterThan(0);
    assembler.reset();
    expect(assembler.pending).toBe(0);
  });

  it('should skip junk between packets', () => {
    const pkt = buildShortPacket(0x11, 0x00, 0x00, 0x0f, 0x0c);
    const junk = Buffer.from([0x00, 0xff, 0x12]);
    const assembler = new PacketAssembler();

    const packets = assembler.feed(Buffer.concat([junk, pkt]));
    expect(packets.length).toBe(1);
    expect(packets[0].crcValid).toBe(true);
  });
});
