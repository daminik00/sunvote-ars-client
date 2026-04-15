import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

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
  spawn: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { platform } from 'os';
import { execFileSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import {
  checkDriver,
  installDriver,
  getDriverInstallInfo,
  openDriverDownloadPage,
  FTDI_DRIVER_DOWNLOAD_PAGE,
} from '../src/driver-check.js';

describe('checkDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns installed=true on macOS', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('darwin');
    const status = await checkDriver();
    expect(status.installed).toBe(true);
    expect(status.platform).toBe('darwin');
    expect(status.message).toContain('macOS');
    expect(status.canAutoInstall).toBe(false);
    expect(status.downloadUrl).toBeNull();
  });

  it('returns installed=true on Linux when ftdi_sio module exists', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('');
    const status = await checkDriver();
    expect(status.installed).toBe(true);
    expect(status.platform).toBe('linux');
    expect(status.message).toContain('ftdi_sio');
    expect(status.downloadUrl).toBeNull();
    expect(execFileSync).toHaveBeenCalledWith('modinfo', ['ftdi_sio'], expect.any(Object));
  });

  it('returns installed=false on Linux when ftdi_sio is missing', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Module not found');
    });
    const status = await checkDriver();
    expect(status.installed).toBe(false);
    expect(status.message).toContain('modprobe');
    expect(status.downloadUrl).toBeNull();
  });

  it('returns installed=true on Windows when FTDI registry key exists', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    (execFileSync as ReturnType<typeof vi.fn>).mockReturnValue('  Start  REG_DWORD  0x3');
    const status = await checkDriver();
    expect(status.installed).toBe(true);
    expect(status.platform).toBe('win32');
    expect(status.canAutoInstall).toBe(true);
    expect(status.downloadUrl).toBeNull();
  });

  it('returns installed=false with downloadUrl on Windows when registry key is missing', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    (execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Key not found');
    });
    const status = await checkDriver();
    expect(status.installed).toBe(false);
    expect(status.canAutoInstall).toBe(true);
    expect(status.downloadUrl).toBe(FTDI_DRIVER_DOWNLOAD_PAGE);
    expect(status.message).toContain('Windows Update');
  });

  it('returns installed=false for unknown platform', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('freebsd');
    const status = await checkDriver();
    expect(status.installed).toBe(false);
    expect(status.message).toContain('Unknown platform');
  });
});

describe('getDriverInstallInfo', () => {
  it('reports needed=true when driver is missing', () => {
    const info = getDriverInstallInfo({
      installed: false,
      message: '',
      platform: 'win32',
      canAutoInstall: true,
      downloadUrl: FTDI_DRIVER_DOWNLOAD_PAGE,
    });
    expect(info.needed).toBe(true);
    expect(info.downloadUrl).toBe(FTDI_DRIVER_DOWNLOAD_PAGE);
    expect(info.instructions).toMatch(/FTDI|Setup Executable/i);
  });

  it('reports needed=false when driver is installed', () => {
    const info = getDriverInstallInfo({
      installed: true,
      message: '',
      platform: 'darwin',
      canAutoInstall: false,
      downloadUrl: null,
    });
    expect(info.needed).toBe(false);
    expect(info.instructions).toMatch(/no action needed/i);
  });

  it('falls back to landing page when status.downloadUrl is null', () => {
    const info = getDriverInstallInfo({
      installed: false,
      message: '',
      platform: 'linux',
      canAutoInstall: false,
      downloadUrl: null,
    });
    expect(info.downloadUrl).toBe(FTDI_DRIVER_DOWNLOAD_PAGE);
    expect(info.instructions).toMatch(/modprobe|dialout/);
  });

  it('handles unknown platform gracefully', () => {
    const info = getDriverInstallInfo({
      installed: false,
      message: '',
      platform: 'aix',
      canAutoInstall: false,
      downloadUrl: null,
    });
    expect(info.instructions).toContain('aix');
    expect(info.downloadUrl).toBe(FTDI_DRIVER_DOWNLOAD_PAGE);
  });
});

describe('openDriverDownloadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fakeChild = Object.assign(new EventEmitter(), { unref: vi.fn() });
    (spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
      // Emit `spawn` asynchronously so the listener attaches first.
      setImmediate(() => fakeChild.emit('spawn'));
      return fakeChild;
    });
  });

  it('uses `open` on macOS', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('darwin');
    const url = await openDriverDownloadPage();
    expect(url).toBe(FTDI_DRIVER_DOWNLOAD_PAGE);
    expect(spawn).toHaveBeenCalledWith('open', [FTDI_DRIVER_DOWNLOAD_PAGE], expect.any(Object));
  });

  it('uses `cmd /c start` on Windows', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    await openDriverDownloadPage('https://example.com/');
    expect(spawn).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '""', 'https://example.com/'],
      expect.any(Object),
    );
  });

  it('uses `xdg-open` on Linux', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
    await openDriverDownloadPage();
    expect(spawn).toHaveBeenCalledWith(
      'xdg-open',
      [FTDI_DRIVER_DOWNLOAD_PAGE],
      expect.any(Object),
    );
  });

  it('rejects when spawn emits an error', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('linux');
    const fakeChild = Object.assign(new EventEmitter(), { unref: vi.fn() });
    (spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      setImmediate(() => fakeChild.emit('error', new Error('xdg-open not found')));
      return fakeChild;
    });
    await expect(openDriverDownloadPage()).rejects.toThrow('xdg-open not found');
  });
});

describe('installDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true immediately on non-Windows platforms', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('darwin');
    expect(await installDriver('/some/path')).toBe(true);
  });

  it('throws if inf files are not found on Windows', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await expect(installDriver('/drivers')).rejects.toThrow('Driver file not found');
  });

  it('throws if inf files are partially missing on Windows', async () => {
    (platform as ReturnType<typeof vi.fn>).mockReturnValue('win32');
    (existsSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    await expect(installDriver('/drivers')).rejects.toThrow('Driver file not found');
  });
});
