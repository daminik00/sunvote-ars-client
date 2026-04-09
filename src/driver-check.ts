/**
 * FTDI driver detection and installation helpers.
 *
 * - macOS: Built-in AppleUSBFTDI — no installation needed
 * - Linux: Built-in ftdi_sio kernel module — no installation needed
 *          (user must be in `dialout` group)
 * - Windows: FTDI CDM driver must be installed separately
 */

import { platform } from 'os';
import { execFileSync, execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface DriverStatus {
  /** Whether the FTDI driver is installed and working */
  installed: boolean;
  /** Human-readable status message */
  message: string;
  /** Platform identifier */
  platform: 'win32' | 'darwin' | 'linux' | string;
  /** Whether automatic installation is possible */
  canAutoInstall: boolean;
}

/**
 * Check if the FTDI serial driver is installed.
 *
 * @example
 * ```ts
 * const status = await checkDriver();
 * if (!status.installed) {
 *   console.log(status.message);
 * }
 * ```
 */
export async function checkDriver(): Promise<DriverStatus> {
  const os = platform();

  if (os === 'darwin') {
    return {
      installed: true,
      message: 'macOS has built-in FTDI support (AppleUSBFTDI)',
      platform: os,
      canAutoInstall: false,
    };
  }

  if (os === 'linux') {
    try {
      execFileSync('modinfo', ['ftdi_sio'], { stdio: 'pipe' });
      return {
        installed: true,
        message: 'Linux ftdi_sio driver available. Ensure user is in dialout group: sudo usermod -a -G dialout $USER',
        platform: os,
        canAutoInstall: false,
      };
    } catch {
      return {
        installed: false,
        message: 'ftdi_sio kernel module not found. Run: sudo modprobe ftdi_sio',
        platform: os,
        canAutoInstall: false,
      };
    }
  }

  if (os === 'win32') {
    try {
      const output = execFileSync('reg', [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Services\\FTSER2K',
        '/v', 'Start',
      ], { stdio: 'pipe', encoding: 'utf-8' });
      if (output.includes('REG_DWORD')) {
        return {
          installed: true,
          message: 'FTDI driver installed',
          platform: os,
          canAutoInstall: true,
        };
      }
    } catch {
      // Not found
    }

    return {
      installed: false,
      message: 'FTDI driver not found. Install from https://ftdichip.com/drivers/vcp-drivers/',
      platform: os,
      canAutoInstall: true,
    };
  }

  return {
    installed: false,
    message: `Unknown platform: ${os}`,
    platform: os,
    canAutoInstall: false,
  };
}

/**
 * Install the FTDI driver on Windows using pnputil.
 * Must be run with Administrator privileges.
 *
 * @param driverDir - Path to directory containing ftdibus.inf and ftdiport.inf.
 *                    In Electron apps, use `path.join(app.getAppPath(), 'drivers', 'win32')`.
 * @returns Promise that resolves to true on success.
 * @throws Error if not on Windows, files missing, or installation fails.
 *
 * @example
 * ```ts
 * import { app } from 'electron';
 * import { join } from 'path';
 * import { installDriver } from 'sunvote-ars-client';
 *
 * const driverDir = join(app.getAppPath(), 'drivers', 'win32');
 * await installDriver(driverDir);
 * ```
 */
export async function installDriver(driverDir: string): Promise<boolean> {
  if (platform() !== 'win32') {
    return true;
  }

  const infFiles = ['ftdibus.inf', 'ftdiport.inf'];
  for (const inf of infFiles) {
    const infPath = join(driverDir, inf);
    if (!existsSync(infPath)) {
      throw new Error(`Driver file not found: ${infPath}`);
    }
  }

  // Install each .inf via pnputil (safe — no shell, arguments are file paths)
  for (const inf of infFiles) {
    const infPath = join(driverDir, inf);
    await new Promise<void>((resolve, reject) => {
      execFile('pnputil', ['/add-driver', infPath, '/install'], { timeout: 30_000 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`Driver install failed (requires Admin): ${stderr || err.message}`));
          } else {
            resolve();
          }
        });
    });
  }

  return true;
}
