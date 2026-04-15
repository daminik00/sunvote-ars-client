import { buildShortPacket, buildLongPacket, parsePacket, PacketAssembler } from './packet.js';
import {
  BAUD_RATE,
  CmdCode,
  SystemSubCmd,
  type BaseConfig,
  type ConnectionOptions,
  type ParsedPacket,
  type PollResult,
  type VoteOptions,
} from './types.js';

const READ_TIMEOUT = 300;
const WRITE_TIMEOUT = 500;

type SerialPortType = InstanceType<typeof import('serialport').SerialPort>;

function ts(): string {
  return new Date().toISOString();
}

function hexDump(buf: Buffer): string {
  return buf.toString('hex').replace(/(.{2})/g, '$1 ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Low-level serial I/O wrapper for the SunVote PVS-2010 receiver.
 */
export class SunVoteReceiver {
  private port: SerialPortType | null = null;
  private assembler = new PacketAssembler();
  private readonly path: string;
  private readonly baudRate: number;
  private readonly debug: boolean;

  /** Callback invoked when the serial port closes unexpectedly. */
  onDisconnect?: (err: Error) => void;

  constructor(options: ConnectionOptions) {
    this.path = options.path;
    this.baudRate = options.baudRate ?? BAUD_RATE;
    this.debug = options.debug ?? false;
  }

  private log(msg: string): void {
    if (this.debug) {
      console.debug(`[sunvote] ${ts()} ${msg}`);
    }
  }

  /** Open the serial port. */
  async open(): Promise<void> {
    const { SerialPort } = await import('serialport');
    this.log(`Opening port ${this.path} @ ${this.baudRate} baud`);
    return new Promise((resolve, reject) => {
      this.port = new SerialPort(
        {
          path: this.path,
          baudRate: this.baudRate,
          dataBits: 8,
          parity: 'none',
          stopBits: 1,
          autoOpen: false,
        },
      );

      // Listen for unexpected close
      this.port.on('close', () => {
        this.log('Port closed unexpectedly');
        const err = new Error(`Serial port ${this.path} closed unexpectedly`);
        if (this.onDisconnect) {
          this.onDisconnect(err);
        }
      });

      this.port.open((err) => {
        if (err) {
          this.log(`Open failed: ${err.message}`);
          reject(err);
        } else {
          this.log('Port opened successfully');
          resolve();
        }
      });
    });
  }

  /** Close the serial port. */
  async close(): Promise<void> {
    if (!this.port?.isOpen) return;
    this.log('Closing port');
    return new Promise((resolve, reject) => {
      this.port!.close((err) => {
        if (err) reject(err);
        else {
          this.port = null;
          this.assembler.reset();
          this.log('Port closed');
          resolve();
        }
      });
    });
  }

  /** Flush the serial port and assembler buffer. */
  async flush(): Promise<void> {
    this.assembler.reset();
    if (!this.port?.isOpen) return;
    this.log('Flushing port');
    return new Promise((resolve, reject) => {
      this.port!.flush((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Write a packet and read the response. */
  async sendAndReceive(packet: Buffer, timeout: number = READ_TIMEOUT): Promise<ParsedPacket | null> {
    if (!this.port?.isOpen) throw new Error('Port is not open');
    const port = this.port;

    this.log(`TX: ${hexDump(packet)}`);

    // Write
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Write timeout')), WRITE_TIMEOUT);
      port.write(packet, (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else {
          port.drain((drainErr) => {
            if (drainErr) reject(drainErr);
            else resolve();
          });
        }
      });
    });

    // Read with timeout
    return new Promise<ParsedPacket | null>((resolve) => {
      const timer = setTimeout(() => {
        port.removeListener('data', onData);
        this.log('RX: (timeout, no response)');
        resolve(null);
      }, timeout);

      const onData = (data: Buffer): void => {
        this.log(`RX raw: ${hexDump(data)}`);
        const packets = this.assembler.feed(data);
        if (packets.length > 0) {
          clearTimeout(timer);
          port.removeListener('data', onData);
          this.log(`RX parsed: cmd=0x${packets[0].cmd.toString(16)} crcValid=${packets[0].crcValid} len=${packets[0].length}`);
          resolve(packets[0]);
        }
      };

      port.on('data', onData);
    });
  }

  /** Send a packet and read ALL response packets within the timeout window. */
  private async sendAndReceiveAll(packet: Buffer, timeout: number = READ_TIMEOUT): Promise<ParsedPacket[]> {
    if (!this.port?.isOpen) throw new Error('Port is not open');
    const port = this.port;

    this.log(`TX: ${hexDump(packet)}`);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Write timeout')), WRITE_TIMEOUT);
      port.write(packet, (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else {
          port.drain((drainErr) => {
            if (drainErr) reject(drainErr);
            else resolve();
          });
        }
      });
    });

    const allPackets: ParsedPacket[] = [];

    return new Promise<ParsedPacket[]>((resolve) => {
      const timer = setTimeout(() => {
        port.removeListener('data', onData);
        this.log(`RX: ${allPackets.length} packet(s) in window`);
        resolve(allPackets);
      }, timeout);

      const onData = (data: Buffer): void => {
        this.log(`RX raw: ${hexDump(data)}`);
        const packets = this.assembler.feed(data);
        allPackets.push(...packets);
      };

      port.on('data', onData);
    });
  }

  /** Drain any old/stale data from the port. */
  async drainOldData(): Promise<void> {
    this.log('Draining stale data');
    await this.flush();
    // Read and discard for a short period
    if (!this.port?.isOpen) return;
    const port = this.port;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        port.removeListener('data', onData);
        resolve();
      }, 100);
      const onData = (_data: Buffer): void => {
        // discard
      };
      port.on('data', onData);
    });
    this.assembler.reset();
  }

  /**
   * Read the base station configuration.
   * Sends idle poll + BaseScanRd to retrieve baseId, keypad range, channel, etc.
   */
  async readBaseConfig(): Promise<BaseConfig> {
    this.log('Reading base config');

    // 1) Idle poll: System cmd, flags=0x0F, subCmd=IdlePoll
    const idlePoll = buildShortPacket(
      CmdCode.System, 0x00, 0x00, 0x0f, SystemSubCmd.IdlePoll,
      Buffer.alloc(5),
    );
    const idleResp = await this.sendAndReceive(idlePoll);

    let baseId = 0;
    let channel = 0;

    if (idleResp?.crcValid && idleResp.payload.length >= 8) {
      baseId = idleResp.payload[1];
      channel = idleResp.payload[7] ?? 0;
    }

    // 2) BaseScanRd: Scan cmd, flags=0, subCmd=0x06
    const scanRd = buildShortPacket(
      CmdCode.Scan, 0x00, 0x00, 0x00, 0x06,
      Buffer.alloc(5),
    );
    const scanResp = await this.sendAndReceive(scanRd);

    let keyFrom = 1;
    let keyTo = 50;
    let keyMax = 50;

    if (scanResp?.crcValid && scanResp.payload.length >= 9) {
      keyFrom = (scanResp.payload[5] << 8) | scanResp.payload[6];
      keyTo = (scanResp.payload[7] << 8) | scanResp.payload[8];
      keyMax = keyTo - keyFrom + 1;
    }

    const config = { baseId, keyFrom, keyTo, keyMax, channel };
    this.log(`Base config: ${JSON.stringify(config)}`);
    return config;
  }

  /**
   * Write base station configuration.
   *
   * Sends two packets matching the captured SunVoteARS protocol:
   *   1. BaseIniWr (System/0x0B) with data `[baseId, keyFrom, channel, 0, 0]`.
   *      The keypad *range* lives only in the BaseZoneWr packet below —
   *      including `keyTo` here would push `channel` into the next byte and
   *      corrupt the base's stored channel (observed bug: writing `keyTo=40`
   *      silently overwrote `channel` with 40).
   *   2. BaseZoneWr (Scan/0x05) with the 16-bit keyFrom / keyTo range.
   */
  async writeBaseConfig(config: BaseConfig): Promise<void> {
    this.log(`Writing base config: ${JSON.stringify(config)}`);

    const iniPacket = buildShortPacket(
      CmdCode.System, 0x00, 0x00, 0x0f, SystemSubCmd.BaseIniWrite,
      [config.baseId, config.keyFrom & 0xff, config.channel, 0, 0],
    );
    await this.sendAndReceive(iniPacket);

    const zonePacket = buildShortPacket(
      CmdCode.Scan, 0x00, 0x00, 0x00, 0x05,
      [
        (config.keyFrom >> 8) & 0xff,
        config.keyFrom & 0xff,
        (config.keyTo >> 8) & 0xff,
        config.keyTo & 0xff,
        0,
      ],
    );
    await this.sendAndReceive(zonePacket);
  }

  /**
   * Start a voting session.
   *
   * Replays the 4-step activation sequence captured from the original SunVoteARS
   * Windows client. All four steps are required: sending only the C1 packet is
   * ACK'd by the base but the base never broadcasts the RF wake command, so the
   * keypads stay asleep and every subsequent poll returns an empty slot (type=FF).
   *
   * Sequence (flag byte at payload[3]):
   *   1. C1 — Start scan with mode/options/min-max
   *   2. C2 — Clear (presumably resets the base's session state / RF buffer)
   *   3. C4 — Initial poll (primes the response pipeline)
   *   4. C5 long packet × 2 — first targeted to the base, second broadcast (arg1=0xC7)
   *      with a 50ms gap between them so the keypads receive the RF wake signal
   *
   * @param baseId - base station ID
   * @param options - voting parameters
   */
  async startVoteSession(baseId: number, options: VoteOptions = {}): Promise<ParsedPacket | null> {
    this.log(`Starting vote session for base ${baseId}`);
    const mode = options.mode ?? 0x05;
    const numOptions = options.options ?? 0x02;
    const maxSel = options.maxSelections ?? 0x06;
    const minSel = options.minSelections ?? 0x01;

    // Step 1: C1 start scan
    const startPacket = buildShortPacket(
      CmdCode.Scan, baseId, 0x00, 0xc1, 0x02,
      [mode, numOptions, maxSel, minSel, 0x00],
    );
    const startResp = await this.sendAndReceive(startPacket);

    // Step 2: C2 clear
    const clearPacket = buildShortPacket(
      CmdCode.Scan, baseId, 0x00, 0xc2, 0x00,
      Buffer.alloc(5),
    );
    await this.sendAndReceive(clearPacket);

    // Step 3: C4 initial poll
    const initPollPacket = buildShortPacket(
      CmdCode.Scan, baseId, 0x00, 0xc4, 0x00,
      Buffer.alloc(5),
    );
    await this.sendAndReceive(initPollPacket);

    // Step 4a: C5 long scan, targeted
    const c5Targeted = buildLongPacket(
      CmdCode.Scan, baseId, 0x00, 0xc5,
      Buffer.alloc(19),
    );
    await this.sendAndReceive(c5Targeted, 100);
    await sleep(50);

    // Step 4b: C5 long scan, broadcast (arg1=0xC7). This is the RF wake signal.
    const c5Broadcast = buildLongPacket(
      CmdCode.Scan, 0xc7, 0x00, 0xc5,
      Buffer.alloc(19),
    );
    await this.sendAndReceive(c5Broadcast, 100);
    await sleep(50);

    return startResp;
  }

  /**
   * Stop the current voting session.
   */
  async stopVoteSession(baseId: number): Promise<ParsedPacket | null> {
    this.log(`Stopping vote session for base ${baseId}`);
    const stopPacket = buildShortPacket(
      CmdCode.Scan, baseId, 0x00, 0xc3, 0x00,
      Buffer.alloc(5),
    );
    return this.sendAndReceive(stopPacket);
  }

  /**
   * Poll keypads for button presses.
   *
   * Mirrors the reference Python implementation: flush input buffer, fire the
   * three packets in rapid succession (C5 ACK + C5 broadcast + C4 poll) with
   * 20ms inter-packet gaps, then read whatever the base emits for ~400ms and
   * extract every complete response packet. Previously we used
   * send-receive-send-receive-send-receive with individual 100ms timeouts,
   * which desynced the base's response batching on some firmware revisions.
   *
   * @param baseId - base station ID
   * @param ackByte - acknowledgement byte from previous poll cycle (0 on first call)
   * @returns PollResult with entries and new ackByte
   */
  async pollKeypads(baseId: number, ackByte: number = 0): Promise<PollResult> {
    const entries: Array<{ keypadId: number; button: number; counter: number }> = [];
    if (!this.port?.isOpen) throw new Error('Port is not open');
    const port = this.port;

    // Reset assembler + port buffer so we read a clean burst per cycle.
    this.assembler.reset();
    await new Promise<void>((resolve, reject) => {
      port.flush((err) => (err ? reject(err) : resolve()));
    });

    // 1) C5 ACK with ackByte; 2) C5 broadcast (arg1=0xC7); 3) C4 poll
    const ackData = Buffer.alloc(19);
    ackData[0] = ackByte;
    const ackPacket = buildLongPacket(CmdCode.Scan, baseId, 0x00, 0xc5, ackData);
    const broadcastPacket = buildLongPacket(CmdCode.Scan, 0xc7, 0x00, 0xc5, Buffer.alloc(19));
    const pollPacket = buildShortPacket(CmdCode.Scan, baseId, 0x00, 0xc4, 0x00, Buffer.alloc(5));

    await this.writeRaw(ackPacket);
    await sleep(20);
    await this.writeRaw(broadcastPacket);
    await sleep(20);
    await this.writeRaw(pollPacket);

    // Read any responses for 400ms (matches Python reference timing).
    const received: ParsedPacket[] = [];
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        port.removeListener('data', onData);
        resolve();
      }, 400);
      const onData = (data: Buffer): void => {
        this.log(`RX raw: ${hexDump(data)}`);
        const packets = this.assembler.feed(data);
        for (const p of packets) {
          this.log(`RX parsed: cmd=0x${p.cmd.toString(16)} crcValid=${p.crcValid} len=${p.length}`);
          received.push(p);
        }
      };
      port.on('data', onData);
      // Extra insurance: deadline above already calls cleanup on timer fire.
      deadline;
    });

    let newAckByte = 0;
    for (const resp of received) {
      if (!resp.crcValid) continue;
      // Long response (LEN=0x20): payload[0]=cmd, payload[1..3]=headers, payload[4]=status.
      // status=0xFF → no keypad data in this row; otherwise keypadId at [7], button at [8].
      if (resp.payload.length < 14) continue;
      const status = resp.payload[4];
      if (status === 0xff) continue;

      const keypadId = resp.payload[7];
      const button = resp.payload[8];
      // Per-keypad "counter"/sequence byte — captured at slot position 9
      // (full packet offset pkt[17]). Purpose not fully known: observed to be
      // stable for the same keypad across presses, but may carry a signal
      // we'll use for repeat-press detection once verified on hardware.
      const counter = resp.payload[13];
      newAckByte = status;

      if (keypadId > 0) {
        entries.push({ keypadId, button, counter });
        this.log(`Poll: keypad=${keypadId} button=0x${button.toString(16)} counter=0x${counter.toString(16)}`);
      }
    }

    return { entries, ackByte: newAckByte };
  }

  /** Write a packet to the port without reading any response. */
  private async writeRaw(packet: Buffer): Promise<void> {
    if (!this.port?.isOpen) throw new Error('Port is not open');
    const port = this.port;
    this.log(`TX: ${hexDump(packet)}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Write timeout')), WRITE_TIMEOUT);
      port.write(packet, (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else port.drain((drainErr) => (drainErr ? reject(drainErr) : resolve()));
      });
    });
  }

  /**
   * Write a keypad ID to a keypad in programming mode.
   */
  async writeKeypadId(keypadId: number): Promise<ParsedPacket | null> {
    this.log(`Writing keypad ID: ${keypadId}`);
    const packet = buildShortPacket(
      CmdCode.System, 0x00, 0x00, 0x0f, SystemSubCmd.KeypadWrite,
      [
        (keypadId >> 8) & 0xff,
        keypadId & 0xff,
        0x00, 0x00, 0x00,
      ],
    );
    return this.sendAndReceive(packet);
  }

  /**
   * Read the keypad ID from a keypad in programming mode.
   */
  async readKeypadId(): Promise<number | null> {
    this.log('Reading keypad ID');
    const packet = buildShortPacket(
      CmdCode.System, 0x00, 0x00, 0x0f, SystemSubCmd.KeypadRead,
      Buffer.alloc(5),
    );
    const resp = await this.sendAndReceive(packet);
    if (!resp?.crcValid || resp.payload.length < 7) return null;
    const id = (resp.payload[5] << 8) | resp.payload[6];
    this.log(`Read keypad ID: ${id}`);
    return id;
  }
}
