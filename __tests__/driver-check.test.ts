import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock child_process and fs modules used by driver-check
// ---------------------------------------------------------------------------

vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return {
    ...original,
    platform: vi.fn().mockReturnValue('darwin'),
  };
});

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { platform } from 'os';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { checkDriver, installDriver } from '../src/driver-check.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns installed=true on macOS (built-in AppleUSBFTDI)', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('darwin');

    const status = await checkDriver();

    expect(status.installed).toBe(true);
    expect(status.platform).toBe('darwin');
    expect(status.message).toContain('macOS');
    expect(status.canAutoInstall).toBe(false);
  });

  it('returns installed=true on Linux when ftdi_sio module exists', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');

    const status = await checkDriver();

    expect(status.installed).toBe(true);
    expect(status.platform).toBe('linux');
    expect(status.message).toContain('ftdi_sio');
    expect(execFileSync).toHaveBeenCalledWith('modinfo', ['ftdi_sio'], expect.any(Object));
  });

  it('returns installed=false on Linux when ftdi_sio is missing', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Module not found');
    });

    const status = await checkDriver();

    expect(status.installed).toBe(false);
    expect(status.platform).toBe('linux');
    expect(status.message).toContain('modprobe');
  });

  it('returns installed=true on Windows when FTDI registry key exists', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('  Start  REG_DWORD  0x3');

    const status = await checkDriver();

    expect(status.installed).toBe(true);
    expect(status.platform).toBe('win32');
    expect(status.canAutoInstall).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\FTSER2K']),
      expect.any(Object),
    );
  });

  it('returns installed=false on Windows when registry key is missing', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Key not found');
    });

    const status = await checkDriver();

    expect(status.installed).toBe(false);
    expect(status.platform).toBe('win32');
    expect(status.message).toContain('ftdichip.com');
  });

  it('returns installed=false for unknown platform', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('freebsd');

    const status = await checkDriver();

    expect(status.installed).toBe(false);
    expect(status.platform).toBe('freebsd');
    expect(status.message).toContain('Unknown platform');
  });
});

describe('installDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true immediately on non-Windows platforms', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('darwin');

    const result = await installDriver('/some/path');

    expect(result).toBe(true);
  });

  it('throws if inf files are not found on Windows', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(installDriver('/drivers')).rejects.toThrow('Driver file not found');
  });

  it('throws if inf files are partially missing on Windows', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    // First file exists, second does not
    (existsSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(installDriver('/drivers')).rejects.toThrow('Driver file not found');
  });
});
