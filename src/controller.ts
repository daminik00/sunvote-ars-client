import { EventEmitter } from 'events';
import { SunVoteReceiver } from './receiver.js';
import { listPorts, findSunVotePort } from './port-discovery.js';
import {
  SessionState,
  BUTTON_LABELS,
  type BaseConfig,
  type ConnectionOptions,
  type KeypadPress,
  type PortInfo,
  type SunVoteEvents,
  type VoteOptions,
} from './types.js';

function ts(): string {
  return new Date().toISOString();
}

/**
 * Minimal typed event emitter.
 */
class TypedEmitter<T extends { [K in keyof T]: (...args: any[]) => void }> extends EventEmitter {
  override emit<K extends keyof T & string>(event: K, ...args: Parameters<T[K]>): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.on(event, listener);
  }

  override once<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.once(event, listener);
  }

  override off<K extends keyof T & string>(event: K, listener: T[K]): this {
    return super.off(event, listener);
  }
}

/**
 * Main public API for the SunVote voting system.
 *
 * State machine: IDLE -> connect() -> CONNECTED -> startVoting() -> VOTING -> stopVoting() -> CONNECTED -> disconnect() -> IDLE
 *
 * Emits events for keypad presses, new keypads, state changes, config reads, and errors.
 *
 * @example
 * ```ts
 * const ctrl = new SunVoteController();
 * ctrl.on('keypad:press', (press) => console.log(press));
 * const config = await ctrl.autoConnect({ debug: true });
 * await ctrl.startVoting();
 * ```
 */
export class SunVoteController extends TypedEmitter<SunVoteEvents> {
  private receiver: SunVoteReceiver | null = null;
  private state: SessionState = SessionState.Idle;
  private baseConfig: BaseConfig | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: number;
  private ackByte: number = 0;
  private debugMode: boolean = false;

  /** Track last button per keypad for dedup. */
  private lastButtonByKeypad: Map<number, number> = new Map();
  /** Track known keypads and their last press for 'keypad:new' events. */
  private knownKeypads: Map<number, KeypadPress | null> = new Map();

  /**
   * Create a new SunVoteController instance.
   *
   * @param options - Controller options.
   * @param options.pollInterval - Interval in ms between poll cycles during voting. Defaults to 50ms.
   */
  constructor(options: { pollInterval?: number } = {}) {
    super();
    this.pollInterval = options.pollInterval ?? 50;
  }

  /**
   * The current session state (idle, connected, or voting).
   * Use this to check whether the controller is ready for an operation.
   */
  get currentState(): SessionState {
    return this.state;
  }

  /**
   * The base station configuration read during connect().
   * Returns null if not yet connected.
   */
  get config(): BaseConfig | null {
    return this.baseConfig;
  }

  /**
   * List all available serial ports on the system.
   * Useful for presenting a port picker to the user.
   *
   * @returns Array of port info objects with path, manufacturer, vendorId, productId.
   */
  static listPorts(): Promise<PortInfo[]> {
    return listPorts();
  }

  /**
   * Find the first SunVote receiver (FTDI-based) serial port.
   * Returns the port path string, or null if no receiver was found.
   *
   * @returns The serial port path (e.g. "/dev/ttyUSB0") or null.
   */
  static findPort(): Promise<string | null> {
    return findSunVotePort();
  }

  /**
   * Find a SunVote receiver automatically and connect to it.
   * This is a convenience method that combines findPort() + connect().
   *
   * @param options - Optional configuration.
   * @param options.baudRate - Serial baud rate. Defaults to 19200.
   * @param options.debug - When true, log all TX/RX packets as hex to console.
   * @returns The base station configuration.
   * @throws Error if no SunVote receiver is found on any serial port.
   *
   * @example
   * ```ts
   * const ctrl = new SunVoteController();
   * const config = await ctrl.autoConnect({ debug: true });
   * console.log(`Connected to base ${config.baseId}`);
   * ```
   */
  async autoConnect(options?: { baudRate?: number; debug?: boolean }): Promise<BaseConfig> {
    const port = await findSunVotePort();
    if (!port) {
      throw new Error('No SunVote receiver found. Ensure the device is plugged in via USB.');
    }
    this.log(`Auto-detected SunVote receiver at ${port}`);
    return this.connect({ path: port, baudRate: options?.baudRate, debug: options?.debug });
  }

  /**
   * Connect to the receiver at the given serial port.
   * Opens the serial port, drains stale data, and reads the base station configuration.
   *
   * Must be called from the Idle state. After success, the controller moves to Connected.
   *
   * @param options - Connection options including port path and optional baud rate / debug flag.
   * @returns The base station configuration (baseId, keypad range, channel).
   * @throws Error if already connected, or if the serial port cannot be opened.
   *
   * @example
   * ```ts
   * const config = await ctrl.connect({ path: '/dev/ttyUSB0', debug: true });
   * ```
   */
  async connect(options: ConnectionOptions): Promise<BaseConfig> {
    if (this.state !== SessionState.Idle) {
      throw new Error(`Cannot connect in state: ${this.state}`);
    }

    this.debugMode = options.debug ?? false;
    this.log(`Connecting to ${options.path}`);

    this.receiver = new SunVoteReceiver(options);

    // Handle unexpected disconnects from the serial port
    this.receiver.onDisconnect = (err: Error) => {
      this.log(`Disconnected unexpectedly: ${err.message}`);
      this.cancelPoll();
      this.receiver = null;
      this.baseConfig = null;
      this.knownKeypads.clear();
      this.lastButtonByKeypad.clear();
      const oldState = this.state;
      this.state = SessionState.Idle;
      if (oldState !== SessionState.Idle) {
        this.emit('state:change', SessionState.Idle, oldState);
      }
      this.emit('error', err);
    };

    try {
      await this.receiver.open();
      await this.receiver.drainOldData();
      this.baseConfig = await this.receiver.readBaseConfig();
      this.setState(SessionState.Connected);
      this.emit('base:config', this.baseConfig);
      this.log(`Connected. Base config: ${JSON.stringify(this.baseConfig)}`);
      return this.baseConfig;
    } catch (err) {
      this.log(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.receiver.close().catch(() => {});
      this.receiver = null;
      throw err;
    }
  }

  /**
   * Disconnect from the receiver.
   * If a voting session is active, it will be stopped first. Then the serial port is closed
   * and the controller returns to Idle state.
   *
   * Safe to call from any state -- returns immediately if already idle.
   */
  async disconnect(): Promise<void> {
    if (this.state === SessionState.Idle) return;
    this.log('Disconnecting');

    if (this.state === SessionState.Voting) {
      await this.stopVoting();
    }

    if (this.receiver) {
      await this.receiver.close();
      this.receiver = null;
    }

    this.baseConfig = null;
    this.knownKeypads.clear();
    this.lastButtonByKeypad.clear();
    this.setState(SessionState.Idle);
    this.log('Disconnected');
  }

  /**
   * Start a voting session and begin polling for keypad presses.
   * The controller must be in the Connected state. After calling this, the controller
   * moves to the Voting state and begins emitting 'keypad:press' events.
   *
   * @param options - Voting parameters (mode, number of options, min/max selections).
   * @throws Error if not in Connected state.
   *
   * @example
   * ```ts
   * await ctrl.startVoting({ options: 4, maxSelections: 1 });
   * ctrl.on('keypad:press', (press) => {
   *   console.log(`Keypad ${press.keypadId} pressed ${press.buttonLabel}`);
   * });
   * ```
   */
  async startVoting(options: VoteOptions = {}): Promise<void> {
    if (this.state !== SessionState.Connected) {
      throw new Error(`Cannot start voting in state: ${this.state}`);
    }
    if (!this.receiver || !this.baseConfig) {
      throw new Error('Not connected');
    }

    this.log('Starting voting session');
    await this.receiver.startVoteSession(this.baseConfig.baseId, options);

    this.ackByte = 0;
    this.lastButtonByKeypad.clear();
    this.setState(SessionState.Voting);
    this.schedulePoll();
  }

  /**
   * Stop the voting session and halt polling.
   * The controller moves back to the Connected state. Keypad tracking data is reset.
   *
   * @throws Error if not in Voting state.
   */
  async stopVoting(): Promise<void> {
    if (this.state !== SessionState.Voting) {
      throw new Error(`Cannot stop voting in state: ${this.state}`);
    }
    if (!this.receiver || !this.baseConfig) {
      throw new Error('Not connected');
    }

    this.log('Stopping voting session');
    this.cancelPoll();
    await this.receiver.stopVoteSession(this.baseConfig.baseId);

    this.lastButtonByKeypad.clear();
    this.ackByte = 0;
    this.setState(SessionState.Connected);
  }

  /**
   * Write new base station configuration to the receiver.
   * Must be in the Connected state (not voting).
   *
   * @param config - The new base config to write (baseId, keyFrom, keyTo, keyMax, channel).
   * @throws Error if not in Connected state.
   */
  async writeConfig(config: BaseConfig): Promise<void> {
    if (this.state !== SessionState.Connected) {
      throw new Error(`Cannot write config in state: ${this.state}`);
    }
    if (!this.receiver) throw new Error('Not connected');

    this.log(`Writing config: ${JSON.stringify(config)}`);
    await this.receiver.writeBaseConfig(config);
    this.baseConfig = config;
    this.emit('base:config', config);
  }

  /**
   * Write a keypad ID to a keypad that is in programming mode.
   * The receiver must be connected.
   *
   * @param keypadId - The numeric ID to assign to the keypad.
   * @throws Error if not connected.
   */
  async writeKeypadId(keypadId: number): Promise<void> {
    if (!this.receiver) throw new Error('Not connected');
    await this.receiver.writeKeypadId(keypadId);
  }

  /**
   * Read the keypad ID from a keypad that is in programming mode.
   * The receiver must be connected.
   *
   * @returns The keypad ID, or null if no keypad responded.
   * @throws Error if not connected.
   */
  async readKeypadId(): Promise<number | null> {
    if (!this.receiver) throw new Error('Not connected');
    return this.receiver.readKeypadId();
  }

  /**
   * Get the map of known keypads and their last button press.
   * Keys are keypad IDs; values are the last KeypadPress or null if only seen via 'keypad:new'.
   *
   * @returns A new Map snapshot of known keypads.
   */
  getKeypads(): Map<number, KeypadPress | null> {
    return new Map(this.knownKeypads);
  }

  private log(msg: string): void {
    if (this.debugMode) {
      console.debug(`[sunvote] ${ts()} ${msg}`);
    }
  }

  private setState(newState: SessionState): void {
    const old = this.state;
    if (old === newState) return;
    this.log(`State: ${old} -> ${newState}`);
    this.state = newState;
    this.emit('state:change', newState, old);
  }

  private schedulePoll(): void {
    if (this.state !== SessionState.Voting) return;
    this.pollTimer = setTimeout(() => {
      this.doPoll().catch((err) => {
        this.log(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    }, this.pollInterval);
  }

  private cancelPoll(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async doPoll(): Promise<void> {
    if (this.state !== SessionState.Voting || !this.receiver || !this.baseConfig) return;

    try {
      const result = await this.receiver.pollKeypads(this.baseConfig.baseId, this.ackByte);
      this.ackByte = result.ackByte;

      for (const entry of result.entries) {
        const { keypadId, button, counter } = entry;

        if (!this.knownKeypads.has(keypadId)) {
          this.knownKeypads.set(keypadId, null);
          this.log(`New keypad detected: ${keypadId}`);
          this.emit('keypad:new', keypadId);
        }

        const buttonLabel = BUTTON_LABELS.get(button) ?? `0x${button.toString(16).padStart(2, '0')}`;
        const now = Date.now();
        const rawPress: KeypadPress = { keypadId, button, buttonLabel, timestamp: now, counter };

        // `keypad:click` — every physical tap reported by the base. No dedup.
        // The base itself emits one entry per press on the observed hardware,
        // so subscribers here get one event per physical click.
        this.emit('keypad:click', rawPress);

        if (button === 0x00) {
          this.lastButtonByKeypad.delete(keypadId);
          continue;
        }

        // `keypad:press` — deduplicated. Only fires when the button *value*
        // differs from the last seen button for this keypad. Prevents flooding
        // if the base or a firmware quirk ever re-reports the same press across
        // multiple poll cycles.
        const lastButton = this.lastButtonByKeypad.get(keypadId) ?? 0;
        if (button !== lastButton) {
          this.lastButtonByKeypad.set(keypadId, button);
          this.knownKeypads.set(keypadId, rawPress);
          this.emit('keypad:press', rawPress);
        }
      }
    } catch (err) {
      this.log(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }

    // Schedule next poll using recursive setTimeout
    this.schedulePoll();
  }
}
