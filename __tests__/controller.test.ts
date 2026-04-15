import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionState, BUTTON_LABELS } from '../src/types.js';
import type { BaseConfig, KeypadPress, PollResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mock the receiver and port-discovery modules
// ---------------------------------------------------------------------------

const mockReceiver = {
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  drainOldData: vi.fn().mockResolvedValue(undefined),
  readBaseConfig: vi.fn().mockResolvedValue({
    baseId: 1,
    keyFrom: 1,
    keyTo: 50,
    keyMax: 50,
    channel: 3,
  } satisfies BaseConfig),
  writeBaseConfig: vi.fn().mockResolvedValue(undefined),
  startVoteSession: vi.fn().mockResolvedValue(null),
  stopVoteSession: vi.fn().mockResolvedValue(null),
  pollKeypads: vi.fn().mockResolvedValue({ entries: [], ackByte: 0 } satisfies PollResult),
  writeKeypadId: vi.fn().mockResolvedValue(null),
  readKeypadId: vi.fn().mockResolvedValue(42),
  onDisconnect: undefined as ((err: Error) => void) | undefined,
};

vi.mock('../src/receiver.js', () => ({
  SunVoteReceiver: vi.fn().mockImplementation(() => mockReceiver),
}));

vi.mock('../src/port-discovery.js', () => ({
  listPorts: vi.fn().mockResolvedValue([]),
  findSunVotePort: vi.fn().mockResolvedValue('/dev/ttyUSB0'),
}));

import { SunVoteController } from '../src/controller.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SunVoteController', () => {
  let ctrl: SunVoteController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockReceiver.onDisconnect = undefined;
    mockReceiver.readBaseConfig.mockResolvedValue({
      baseId: 1, keyFrom: 1, keyTo: 50, keyMax: 50, channel: 3,
    });
    mockReceiver.pollKeypads.mockResolvedValue({ entries: [], ackByte: 0 });
    mockReceiver.close.mockResolvedValue(undefined);
    ctrl = new SunVoteController({ pollInterval: 50 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- State machine ----

  describe('state machine', () => {
    it('initial state is Idle', () => {
      expect(ctrl.currentState).toBe(SessionState.Idle);
    });

    it('connect() transitions to Connected', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      expect(ctrl.currentState).toBe(SessionState.Connected);
    });

    it('connect() in wrong state throws', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await expect(ctrl.connect({ path: '/dev/ttyUSB0' })).rejects.toThrow(
        'Cannot connect in state: connected',
      );
    });

    it('startVoting() transitions to Voting', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();
      expect(ctrl.currentState).toBe(SessionState.Voting);
    });

    it('startVoting() in wrong state throws', async () => {
      await expect(ctrl.startVoting()).rejects.toThrow(
        'Cannot start voting in state: idle',
      );
    });

    it('stopVoting() transitions to Connected', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();
      await ctrl.stopVoting();
      expect(ctrl.currentState).toBe(SessionState.Connected);
    });

    it('stopVoting() in wrong state throws', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await expect(ctrl.stopVoting()).rejects.toThrow(
        'Cannot stop voting in state: connected',
      );
    });

    it('disconnect() from Connected goes to Idle', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.disconnect();
      expect(ctrl.currentState).toBe(SessionState.Idle);
    });

    it('disconnect() from Voting goes to Idle (stops voting first)', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();
      await ctrl.disconnect();
      expect(ctrl.currentState).toBe(SessionState.Idle);
      expect(mockReceiver.stopVoteSession).toHaveBeenCalled();
    });

    it('disconnect() from Idle is a no-op', async () => {
      await ctrl.disconnect();
      expect(ctrl.currentState).toBe(SessionState.Idle);
      expect(mockReceiver.close).not.toHaveBeenCalled();
    });
  });

  // ---- Events ----

  describe('events', () => {
    it('state:change fires on connect', async () => {
      const handler = vi.fn();
      ctrl.on('state:change', handler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });

      expect(handler).toHaveBeenCalledWith(SessionState.Connected, SessionState.Idle);
    });

    it('state:change fires on startVoting', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });

      const handler = vi.fn();
      ctrl.on('state:change', handler);

      await ctrl.startVoting();

      expect(handler).toHaveBeenCalledWith(SessionState.Voting, SessionState.Connected);
    });

    it('state:change fires on stopVoting', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();

      const handler = vi.fn();
      ctrl.on('state:change', handler);

      await ctrl.stopVoting();

      expect(handler).toHaveBeenCalledWith(SessionState.Connected, SessionState.Voting);
    });

    it('state:change fires on disconnect', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });

      const handler = vi.fn();
      ctrl.on('state:change', handler);

      await ctrl.disconnect();

      expect(handler).toHaveBeenCalledWith(SessionState.Idle, SessionState.Connected);
    });

    it('base:config fires on connect', async () => {
      const handler = vi.fn();
      ctrl.on('base:config', handler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ baseId: 1, channel: 3 }),
      );
    });

    it('error event fires on unexpected disconnect', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });

      const errorHandler = vi.fn();
      ctrl.on('error', errorHandler);

      // Simulate unexpected disconnect
      expect(mockReceiver.onDisconnect).toBeDefined();
      mockReceiver.onDisconnect!(new Error('USB unplugged'));

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(errorHandler.mock.calls[0][0].message).toBe('USB unplugged');
      expect(ctrl.currentState).toBe(SessionState.Idle);
    });
  });

  // ---- Keypad polling ----

  describe('keypad events', () => {
    it('keypad:new fires first time a keypad is seen', async () => {
      mockReceiver.pollKeypads.mockResolvedValueOnce({
        entries: [{ keypadId: 10, button: 0x01, counter: 0 }],
        ackByte: 1,
      });

      const newHandler = vi.fn();
      ctrl.on('keypad:new', newHandler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();

      // Advance timer to trigger first poll
      await vi.advanceTimersByTimeAsync(60);

      expect(newHandler).toHaveBeenCalledWith(10);
    });

    it('keypad:press fires on new button press', async () => {
      mockReceiver.pollKeypads.mockResolvedValueOnce({
        entries: [{ keypadId: 10, button: 0x01, counter: 0x0a }],
        ackByte: 1,
      });

      const pressHandler = vi.fn();
      ctrl.on('keypad:press', pressHandler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();

      await vi.advanceTimersByTimeAsync(60);

      expect(pressHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          keypadId: 10,
          button: 0x01,
          buttonLabel: '1/A',
          counter: 0x0a,
        }),
      );
    });

    it('keypad:click fires on every poll entry; keypad:press dedups on unchanged button', async () => {
      mockReceiver.pollKeypads
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x01, counter: 0x0a }],
          ackByte: 1,
        })
        .mockResolvedValueOnce({
          // Same button, new counter value
          entries: [{ keypadId: 10, button: 0x01, counter: 0x0b }],
          ackByte: 1,
        })
        .mockResolvedValue({ entries: [], ackByte: 0 });

      const clickHandler = vi.fn();
      const pressHandler = vi.fn();
      ctrl.on('keypad:click', clickHandler);
      ctrl.on('keypad:press', pressHandler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();
      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(60);

      // :click fires both times; :press only the first (button unchanged on second poll).
      expect(clickHandler).toHaveBeenCalledTimes(2);
      expect(clickHandler.mock.calls[0][0]).toMatchObject({ button: 0x01, counter: 0x0a });
      expect(clickHandler.mock.calls[1][0]).toMatchObject({ button: 0x01, counter: 0x0b });
      expect(pressHandler).toHaveBeenCalledTimes(1);
    });

    it('same button on same keypad does not re-emit (dedup)', async () => {
      // First poll: button 0x01
      mockReceiver.pollKeypads
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x01, counter: 0 }],
          ackByte: 1,
        })
        // Second poll: same button 0x01
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x01, counter: 0 }],
          ackByte: 1,
        });

      const pressHandler = vi.fn();
      ctrl.on('keypad:press', pressHandler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();

      // First poll
      await vi.advanceTimersByTimeAsync(60);
      // Second poll
      await vi.advanceTimersByTimeAsync(60);

      // Should only fire once due to dedup
      expect(pressHandler).toHaveBeenCalledTimes(1);
    });

    it('different button on same keypad does emit', async () => {
      mockReceiver.pollKeypads
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x01, counter: 0 }],
          ackByte: 1,
        })
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x02, counter: 0 }],
          ackByte: 1,
        });

      const pressHandler = vi.fn();
      ctrl.on('keypad:press', pressHandler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();

      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(60);

      expect(pressHandler).toHaveBeenCalledTimes(2);
      expect(pressHandler.mock.calls[0][0].button).toBe(0x01);
      expect(pressHandler.mock.calls[1][0].button).toBe(0x02);
    });

    it('button 0x00 resets dedup tracking, allowing same button to re-emit', async () => {
      mockReceiver.pollKeypads
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x01, counter: 0 }],
          ackByte: 1,
        })
        // Button released (0x00)
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x00, counter: 0 }],
          ackByte: 0,
        })
        // Same button pressed again
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x01, counter: 0 }],
          ackByte: 1,
        });

      const pressHandler = vi.fn();
      ctrl.on('keypad:press', pressHandler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();

      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(60);

      // Should fire twice: first press + re-press after reset
      expect(pressHandler).toHaveBeenCalledTimes(2);
    });

    it('keypad:new does not fire again for known keypads', async () => {
      mockReceiver.pollKeypads
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x01, counter: 0 }],
          ackByte: 1,
        })
        .mockResolvedValueOnce({
          entries: [{ keypadId: 10, button: 0x02, counter: 0 }],
          ackByte: 1,
        });

      const newHandler = vi.fn();
      ctrl.on('keypad:new', newHandler);

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();

      await vi.advanceTimersByTimeAsync(60);
      await vi.advanceTimersByTimeAsync(60);

      // Only emitted once for keypad 10
      expect(newHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Config and keypads ----

  describe('config and keypad management', () => {
    it('config returns the base config after connect', async () => {
      expect(ctrl.config).toBeNull();
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      expect(ctrl.config).toEqual(
        expect.objectContaining({ baseId: 1, keyFrom: 1, keyTo: 50 }),
      );
    });

    it('writeConfig sends config to receiver', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      const newConfig: BaseConfig = { baseId: 2, keyFrom: 1, keyTo: 100, keyMax: 100, channel: 5 };
      await ctrl.writeConfig(newConfig);
      expect(mockReceiver.writeBaseConfig).toHaveBeenCalledWith(newConfig);
      expect(ctrl.config).toEqual(newConfig);
    });

    it('writeConfig throws if not connected', async () => {
      const cfg: BaseConfig = { baseId: 1, keyFrom: 1, keyTo: 50, keyMax: 50, channel: 3 };
      await expect(ctrl.writeConfig(cfg)).rejects.toThrow('Cannot write config in state: idle');
    });

    it('getKeypads returns a snapshot', async () => {
      mockReceiver.pollKeypads.mockResolvedValueOnce({
        entries: [{ keypadId: 7, button: 0x02, counter: 0 }],
        ackByte: 1,
      });

      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.startVoting();
      await vi.advanceTimersByTimeAsync(60);

      const keypads = ctrl.getKeypads();
      expect(keypads.has(7)).toBe(true);
      const press = keypads.get(7);
      expect(press).not.toBeNull();
      expect(press!.button).toBe(0x02);
    });
  });

  // ---- autoConnect ----

  describe('autoConnect', () => {
    it('finds a port and connects', async () => {
      const config = await ctrl.autoConnect();
      expect(ctrl.currentState).toBe(SessionState.Connected);
      expect(config.baseId).toBe(1);
    });

    it('throws when no port is found', async () => {
      const { findSunVotePort } = await import('../src/port-discovery.js');
      (findSunVotePort as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const ctrl2 = new SunVoteController();
      await expect(ctrl2.autoConnect()).rejects.toThrow('No SunVote receiver found');
    });
  });

  // ---- writeKeypadId / readKeypadId ----

  describe('keypad ID operations', () => {
    it('writeKeypadId delegates to receiver', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      await ctrl.writeKeypadId(42);
      expect(mockReceiver.writeKeypadId).toHaveBeenCalledWith(42);
    });

    it('writeKeypadId throws if not connected', async () => {
      await expect(ctrl.writeKeypadId(42)).rejects.toThrow('Not connected');
    });

    it('readKeypadId delegates to receiver', async () => {
      await ctrl.connect({ path: '/dev/ttyUSB0' });
      const id = await ctrl.readKeypadId();
      expect(id).toBe(42);
      expect(mockReceiver.readKeypadId).toHaveBeenCalled();
    });

    it('readKeypadId throws if not connected', async () => {
      await expect(ctrl.readKeypadId()).rejects.toThrow('Not connected');
    });
  });
});
