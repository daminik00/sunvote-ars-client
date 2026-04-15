import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildShortPacket, buildLongPacket } from '../src/packet.js';
import { CmdCode, SystemSubCmd } from '../src/types.js';
import { crc16 } from '../src/crc.js';

// ---------------------------------------------------------------------------
// Helpers to build mock response buffers
// ---------------------------------------------------------------------------

/** Build a valid short response packet (16 bytes) with correct CRC. */
function buildResponse(cmd: number, payloadBytes: number[]): Buffer {
  // payloadBytes should be 10 bytes (LEN=0x0C, payload = LEN-2 = 10)
  while (payloadBytes.length < 10) payloadBytes.push(0x00);
  const payload = Buffer.from(payloadBytes.slice(0, 10));
  payload[0] = cmd;
  const crc = crc16(payload);
  const pkt = Buffer.alloc(16);
  pkt[0] = 0xf5;
  pkt[1] = 0xaa;
  pkt[2] = 0xaa;
  pkt[3] = 0x0c;
  payload.copy(pkt, 4);
  pkt[14] = (crc >> 8) & 0xff;
  pkt[15] = crc & 0xff;
  return pkt;
}

/** Build a valid long response packet (29 bytes) with correct CRC. */
function buildLongResponse(cmd: number, payloadBytes: number[]): Buffer {
  while (payloadBytes.length < 23) payloadBytes.push(0x00);
  const payload = Buffer.from(payloadBytes.slice(0, 23));
  payload[0] = cmd;
  const crc = crc16(payload);
  const pkt = Buffer.alloc(29);
  pkt[0] = 0xf5;
  pkt[1] = 0xaa;
  pkt[2] = 0xaa;
  pkt[3] = 0x19;
  payload.copy(pkt, 4);
  pkt[27] = (crc >> 8) & 0xff;
  pkt[28] = crc & 0xff;
  return pkt;
}

// ---------------------------------------------------------------------------
// Mock for the serialport module
// ---------------------------------------------------------------------------

// Data listeners registered via port.on('data', fn)
let dataListeners: Array<(data: Buffer) => void> = [];
let closeListeners: Array<() => void> = [];

const mockPort = {
  isOpen: true,
  write: vi.fn((_data: Buffer, cb: (err: Error | null) => void) => cb(null)),
  drain: vi.fn((cb: (err: Error | null) => void) => cb(null)),
  flush: vi.fn((cb: (err: Error | null) => void) => cb(null)),
  open: vi.fn((cb: (err: Error | null) => void) => cb(null)),
  close: vi.fn((cb: (err: Error | null) => void) => {
    mockPort.isOpen = false;
    cb(null);
  }),
  on: vi.fn((event: string, listener: (...args: any[]) => void) => {
    if (event === 'data') dataListeners.push(listener as (data: Buffer) => void);
    if (event === 'close') closeListeners.push(listener as () => void);
  }),
  removeListener: vi.fn((event: string, listener: (...args: any[]) => void) => {
    if (event === 'data') {
      dataListeners = dataListeners.filter((l) => l !== listener);
    }
  }),
};

vi.mock('serialport', () => ({
  SerialPort: vi.fn().mockImplementation(() => mockPort),
}));

// We need to import AFTER the mock is set up
import { SunVoteReceiver } from '../src/receiver.js';

// ---------------------------------------------------------------------------
// Helper: emit response data to all registered data listeners
// ---------------------------------------------------------------------------
function emitData(data: Buffer): void {
  for (const listener of [...dataListeners]) {
    listener(data);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SunVoteReceiver', () => {
  let receiver: SunVoteReceiver;

  beforeEach(() => {
    vi.clearAllMocks();
    dataListeners = [];
    closeListeners = [];
    mockPort.isOpen = true;
    receiver = new SunVoteReceiver({ path: '/dev/ttyUSB0' });
  });

  describe('open / close', () => {
    it('should open the serial port', async () => {
      await receiver.open();
      expect(mockPort.open).toHaveBeenCalled();
    });

    it('should close the serial port', async () => {
      await receiver.open();
      await receiver.close();
      expect(mockPort.close).toHaveBeenCalled();
    });
  });

  describe('readBaseConfig', () => {
    it('should parse base config from idle poll and scan responses', async () => {
      await receiver.open();

      // Schedule responses: first call gets idlePoll response, second gets scanRd response.
      // The write mock will push data after each write.
      let callCount = 0;
      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        callCount++;
        cb(null);
        // After drain completes, emit a response
        setTimeout(() => {
          if (callCount === 1) {
            // Idle poll response: payload[1]=baseId=5, payload[7]=channel=3
            const resp = buildResponse(CmdCode.SystemResp, [
              CmdCode.SystemResp, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00,
            ]);
            emitData(resp);
          } else if (callCount === 2) {
            // Scan response: payload[5..6]=keyFrom=1, payload[7..8]=keyTo=30
            const resp = buildResponse(CmdCode.ScanResp, [
              CmdCode.ScanResp, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x1e, 0x00,
            ]);
            emitData(resp);
          }
        }, 5);
      });

      const config = await receiver.readBaseConfig();
      expect(config.baseId).toBe(0x05);
      expect(config.channel).toBe(0x03);
      expect(config.keyFrom).toBe(1);
      expect(config.keyTo).toBe(30);
      expect(config.keyMax).toBe(30);
    });

    it('should return defaults when no valid response is received', async () => {
      await receiver.open();

      // write never emits data -> both reads will timeout
      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
        // No data emitted — will timeout
      });

      const config = await receiver.readBaseConfig();
      // Defaults
      expect(config.baseId).toBe(0);
      expect(config.channel).toBe(0);
      expect(config.keyFrom).toBe(1);
      expect(config.keyTo).toBe(50);
      expect(config.keyMax).toBe(50);
    });
  });

  describe('writeBaseConfig', () => {
    it('should send BaseIniWr and BaseZoneWr packets', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
        // No response needed for write verification
      });

      await receiver.writeBaseConfig({
        baseId: 1,
        keyFrom: 1,
        keyTo: 50,
        keyMax: 50,
        channel: 3,
      });

      // Two writes: BaseIniWr + BaseZoneWr
      expect(mockPort.write).toHaveBeenCalledTimes(2);

      // First packet should be System cmd with BaseIniWrite subCmd
      const firstPacket = mockPort.write.mock.calls[0][0] as Buffer;
      expect(firstPacket[4]).toBe(CmdCode.System);
      expect(firstPacket[8]).toBe(SystemSubCmd.BaseIniWrite);

      // Second packet should be Scan cmd with subCmd=0x05
      const secondPacket = mockPort.write.mock.calls[1][0] as Buffer;
      expect(secondPacket[4]).toBe(CmdCode.Scan);
      expect(secondPacket[8]).toBe(0x05);
    });
  });

  describe('startVoteSession', () => {
    it('sends the 5-packet activation sequence (C1 start, C2 clear, C4 poll, C5×2 wake)', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
      });

      await receiver.startVoteSession(0x01, {
        mode: 0x05,
        options: 0x04,
        maxSelections: 0x02,
        minSelections: 0x01,
      });

      expect(mockPort.write).toHaveBeenCalledTimes(5);

      const c1 = mockPort.write.mock.calls[0][0] as Buffer;
      expect(c1[4]).toBe(CmdCode.Scan);
      expect(c1[5]).toBe(0x01); // baseId
      expect(c1[7]).toBe(0xc1); // flags = Start
      expect(c1[8]).toBe(0x02); // subCmd
      expect(c1[9]).toBe(0x05); // mode
      expect(c1[10]).toBe(0x04); // options
      expect(c1[11]).toBe(0x02); // maxSelections
      expect(c1[12]).toBe(0x01); // minSelections

      const c2 = mockPort.write.mock.calls[1][0] as Buffer;
      expect(c2[7]).toBe(0xc2); // flags = Clear

      const c4 = mockPort.write.mock.calls[2][0] as Buffer;
      expect(c4[7]).toBe(0xc4); // flags = Poll (initial)

      const c5a = mockPort.write.mock.calls[3][0] as Buffer;
      expect(c5a[3]).toBe(0x19); // long packet
      expect(c5a[5]).toBe(0x01); // targeted to baseId
      expect(c5a[7]).toBe(0xc5); // flags = Ack/scan

      const c5b = mockPort.write.mock.calls[4][0] as Buffer;
      expect(c5b[3]).toBe(0x19); // long packet
      expect(c5b[5]).toBe(0xc7); // broadcast to all keypads
      expect(c5b[7]).toBe(0xc5);
    });

    it('uses default vote options', async () => {
      await receiver.open();
      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => cb(null));

      await receiver.startVoteSession(0x01);

      const c1 = mockPort.write.mock.calls[0][0] as Buffer;
      expect(c1[9]).toBe(0x05); // default mode
      expect(c1[10]).toBe(0x02); // default options
      expect(c1[11]).toBe(0x06); // default maxSelections
      expect(c1[12]).toBe(0x01); // default minSelections
    });
  });

  describe('stopVoteSession', () => {
    it('should send a stop packet with correct baseId', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
      });

      await receiver.stopVoteSession(0x01);

      expect(mockPort.write).toHaveBeenCalledTimes(1);
      const pkt = mockPort.write.mock.calls[0][0] as Buffer;
      expect(pkt[4]).toBe(CmdCode.Scan);
      expect(pkt[5]).toBe(0x01); // baseId
      expect(pkt[7]).toBe(0xc3); // flags = 0xC3 (host→base Stop)
    });
  });

  describe('pollKeypads', () => {
    it('should return empty entries when no keypad data', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
        // No data emitted for ACK and broadcast, empty for poll
      });

      const result = await receiver.pollKeypads(0x01, 0);
      expect(result.entries).toEqual([]);
      expect(result.ackByte).toBe(0);
    });

    it('should parse keypad data from poll response', async () => {
      await receiver.open();

      let callCount = 0;
      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        callCount++;
        cb(null);
        // Third write is the C4 poll — emit response with keypad data
        if (callCount === 3) {
          setTimeout(() => {
            // Build a long response with keypad data
            // payload[4]=type (not 0xFF), payload[7]=keypadId=42, payload[8]=button=0x01
            const payloadBytes = new Array(23).fill(0);
            payloadBytes[0] = CmdCode.ScanResp;
            payloadBytes[4] = 0x01; // type != 0xFF means data present
            payloadBytes[7] = 42;   // keypadId
            payloadBytes[8] = 0x01; // button (1/A)
            const resp = buildLongResponse(CmdCode.ScanResp, payloadBytes);
            emitData(resp);
          }, 5);
        }
      });

      const result = await receiver.pollKeypads(0x01, 0);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].keypadId).toBe(42);
      expect(result.entries[0].button).toBe(0x01);
      expect(result.ackByte).toBe(0x01);
    });

    it('should skip entries with type 0xFF (empty slot)', async () => {
      await receiver.open();

      let callCount = 0;
      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        callCount++;
        cb(null);
        if (callCount === 3) {
          setTimeout(() => {
            const payloadBytes = new Array(23).fill(0);
            payloadBytes[0] = CmdCode.ScanResp;
            payloadBytes[4] = 0xff; // empty slot
            payloadBytes[7] = 42;
            payloadBytes[8] = 0x01;
            const resp = buildLongResponse(CmdCode.ScanResp, payloadBytes);
            emitData(resp);
          }, 5);
        }
      });

      const result = await receiver.pollKeypads(0x01, 0);
      expect(result.entries).toHaveLength(0);
    });

    it('should send ackByte in the first packet', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
      });

      await receiver.pollKeypads(0x01, 0x42);

      // First write is the C5 ACK long packet
      expect(mockPort.write).toHaveBeenCalled();
      const ackPkt = mockPort.write.mock.calls[0][0] as Buffer;
      // Long packet: data starts at byte 8 (after header+syscode+len+cmd+b5+b6+flags)
      expect(ackPkt[8]).toBe(0x42); // ackByte
    });

    it('sends correct host→base flag bytes for each sub-packet (C5, C5, C4)', async () => {
      await receiver.open();
      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => cb(null));

      await receiver.pollKeypads(0x01, 0);

      expect(mockPort.write).toHaveBeenCalledTimes(3);
      const ackPkt = mockPort.write.mock.calls[0][0] as Buffer;
      const bcastPkt = mockPort.write.mock.calls[1][0] as Buffer;
      const pollPkt = mockPort.write.mock.calls[2][0] as Buffer;

      // All three go to flags byte at payload[3] = packet[7]
      expect(ackPkt[7]).toBe(0xc5);
      expect(bcastPkt[7]).toBe(0xc5);
      expect(bcastPkt[5]).toBe(0xc7); // broadcast target
      expect(pollPkt[7]).toBe(0xc4);
    });
  });

  describe('writeKeypadId', () => {
    it('should send packet with keypadId split into high and low bytes', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
      });

      await receiver.writeKeypadId(0x0123);

      expect(mockPort.write).toHaveBeenCalledTimes(1);
      const pkt = mockPort.write.mock.calls[0][0] as Buffer;
      expect(pkt[4]).toBe(CmdCode.System);
      expect(pkt[8]).toBe(SystemSubCmd.KeypadWrite);
      expect(pkt[9]).toBe(0x01); // high byte
      expect(pkt[10]).toBe(0x23); // low byte
    });

    it('should handle single-byte keypadId', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
      });

      await receiver.writeKeypadId(5);

      const pkt = mockPort.write.mock.calls[0][0] as Buffer;
      expect(pkt[9]).toBe(0x00); // high byte = 0
      expect(pkt[10]).toBe(0x05); // low byte = 5
    });
  });

  describe('readKeypadId', () => {
    it('should parse keypadId from response', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
        setTimeout(() => {
          // Response payload[5]=high, payload[6]=low => keypadId = 0x0042 = 66
          const resp = buildResponse(CmdCode.SystemResp, [
            CmdCode.SystemResp, 0x00, 0x00, 0x00, 0x00, 0x00, 0x42, 0x00, 0x00, 0x00,
          ]);
          emitData(resp);
        }, 5);
      });

      const id = await receiver.readKeypadId();
      expect(id).toBe(0x0042);
    });

    it('should return null when no response', async () => {
      await receiver.open();

      mockPort.write.mockImplementation((_data: Buffer, cb: (err: Error | null) => void) => {
        cb(null);
        // No data emitted
      });

      const id = await receiver.readKeypadId();
      expect(id).toBeNull();
    });
  });

  describe('drainOldData', () => {
    it('should flush the port and reset assembler', async () => {
      await receiver.open();
      await receiver.drainOldData();
      expect(mockPort.flush).toHaveBeenCalled();
    });
  });

  describe('sendAndReceive', () => {
    it('should throw if port is not open', async () => {
      // Don't call open(), port property stays null
      const pkt = buildShortPacket(CmdCode.System, 0, 0, 0x0f, SystemSubCmd.IdlePoll);
      await expect(receiver.sendAndReceive(pkt)).rejects.toThrow('Port is not open');
    });
  });
});
