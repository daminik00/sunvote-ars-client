/**
 * FTDI driver detection and installation helpers.
 *
 * Driver requirements by platform:
 * - macOS 10.15+: built-in AppleUSBFTDI. Nothing to do.
 * - Linux: built-in ftdi_sio kernel module. User may need to be in `dialout` group.
 * - Windows 10/11: drivers usually auto-install via Windows Update when the FTDI device
 *   is plugged in for the first time. If WU is disabled or unavailable, the end-user
 *   must download the FTDI CDM installer manually from FTDI's official site.
 *
 * IMPORTANT — driver redistribution policy:
 * This package does NOT bundle FTDI's proprietary drivers. FTDI's CDM Driver License
 * (see https://ftdichip.com/drivers/) restricts redistribution to hardware sellers and
 * distributors of devices containing a Genuine FTDI Component. End-users have the right
 * to download and install the driver themselves directly from FTDI.
 *
 * If your application is shipped together with hardware that contains a Genuine FTDI
 * Component (i.e. you are a "seller or distributor of a Device" per the FTDI license),
 * you may bundle the CDM driver files inside your application and pass their path to
 * {@link installDriver}.
 */

import { platform } from 'os';
import { execFileSync, execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/** Public landing page for FTDI VCP/CDM driver downloads. Stable URL. */
export const FTDI_DRIVER_DOWNLOAD_PAGE = 'https://ftdichip.com/drivers/vcp-drivers/';

export interface DriverStatus {
  /** Whether the FTDI driver is installed and working. */
  installed: boolean;
  /** Human-readable status / next-step message. */
  message: string;
  /** Platform identifier as returned by `os.platform()`. */
  platform: 'win32' | 'darwin' | 'linux' | string;
  /** Whether `installDriver(driverDir)` is supported on this OS (Windows only). */
  canAutoInstall: boolean;
  /** Where to download the driver, if user action is required. `null` when not needed. */
  downloadUrl: string | null;
}

export interface DriverInstallInfo {
  /** True when the user must take action to install the driver. */
  needed: boolean;
  /** Official URL to download the driver from. */
  downloadUrl: string;
  /** Human-readable instructions to display to the end-user. */
  instructions: string;
}

/**
 * Check whether the FTDI serial driver is installed and working.
 *
 * @example
 * ```ts
 * const status = await checkDriver();
 * if (!status.installed && status.downloadUrl) {
 *   showDownloadPrompt(status.downloadUrl);
 * }
 * ```
 */
export async function checkDriver(): Promise<DriverStatus> {
  const os = platform();

  if (os === 'darwin') {
    return {
      installed: true,
      message: 'macOS has built-in FTDI support (AppleUSBFTDI).',
      platform: os,
      canAutoInstall: false,
      downloadUrl: null,
    };
  }

  if (os === 'linux') {
    try {
      execFileSync('modinfo', ['ftdi_sio'], { stdio: 'pipe' });
      return {
        installed: true,
        message:
          'Linux ftdi_sio driver is available. Ensure your user is in the `dialout` group: sudo usermod -aG dialout $USER (then log out and back in).',
        platform: os,
        canAutoInstall: false,
        downloadUrl: null,
      };
    } catch {
      return {
        installed: false,
        message: 'ftdi_sio kernel module not found. Run: sudo modprobe ftdi_sio',
        platform: os,
        canAutoInstall: false,
        downloadUrl: null,
      };
    }
  }

  if (os === 'win32') {
    try {
      const output = execFileSync(
        'reg',
        ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\FTSER2K', '/v', 'Start'],
        { stdio: 'pipe', encoding: 'utf-8' },
      );
      if (output.includes('REG_DWORD')) {
        return {
          installed: true,
          message: 'FTDI driver is installed.',
          platform: os,
          canAutoInstall: true,
          downloadUrl: null,
        };
      }
    } catch {
      // Registry key absent — driver not installed.
    }

    return {
      installed: false,
      message:
        'FTDI driver not found. On Windows 10/11 it usually installs automatically via Windows Update a few seconds after the receiver is plugged in. If that does not happen, download the CDM installer from ftdichip.com and run it.',
      platform: os,
      canAutoInstall: true,
      downloadUrl: FTDI_DRIVER_DOWNLOAD_PAGE,
    };
  }

  return {
    installed: false,
    message: `Unknown platform: ${os}`,
    platform: os,
    canAutoInstall: false,
    downloadUrl: null,
  };
}

/**
 * Convenience helper to derive end-user-facing instructions from a {@link DriverStatus}.
 * Useful for showing a download dialog in your application UI.
 *
 * @example
 * ```ts
 * const status = await checkDriver();
 * const info = getDriverInstallInfo(status);
 * if (info.needed) {
 *   showDialog(info.instructions, info.downloadUrl);
 * }
 * ```
 */
export function getDriverInstallInfo(status: DriverStatus): DriverInstallInfo {
  let instructions: string;
  switch (status.platform) {
    case 'win32':
      instructions =
        'Download the FTDI CDM driver Setup Executable from the official FTDI site, run it as Administrator, and reconnect the receiver. Most Windows 10/11 systems install the driver automatically via Windows Update — try waiting 30 seconds after plugging in before installing manually.';
      break;
    case 'linux':
      instructions =
        'Load the kernel module: sudo modprobe ftdi_sio. Then add your user to the dialout group: sudo usermod -aG dialout $USER, and log out / back in.';
      break;
    case 'darwin':
      instructions = 'No action needed — macOS includes FTDI support out of the box.';
      break;
    default:
      instructions = `Driver setup for platform "${status.platform}" is not documented. See ${FTDI_DRIVER_DOWNLOAD_PAGE} for the official driver downloads.`;
  }
  return {
    needed: !status.installed,
    downloadUrl: status.downloadUrl ?? FTDI_DRIVER_DOWNLOAD_PAGE,
    instructions,
  };
}

/**
 * Open the official FTDI driver download page in the system's default browser.
 * Resolves once the OS-level "open" command has been launched (it does not wait for
 * the browser to be ready).
 *
 * @returns The URL that was opened.
 *
 * @example
 * ```ts
 * await openDriverDownloadPage();
 * ```
 */
export async function openDriverDownloadPage(
  url: string = FTDI_DRIVER_DOWNLOAD_PAGE,
): Promise<string> {
  const os = platform();
  let cmd: string;
  let args: string[];
  if (os === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (os === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return url;
}

/**
 * Install the FTDI CDM driver on Windows from a directory containing `ftdibus.inf`
 * and `ftdiport.inf` (and the supporting .sys / .cat / .dll files referenced by them).
 *
 * **Legal note:** FTDI's CDM Driver License only permits driver redistribution by
 * sellers and distributors of devices that contain a Genuine FTDI Component. Use this
 * function only if you have the right to bundle the driver files with your application.
 * For the general case, prefer {@link openDriverDownloadPage} so the end-user downloads
 * the driver directly from FTDI under their own license.
 *
 * Requires Administrator privileges. On non-Windows platforms this is a no-op.
 *
 * @param driverDir Path to a directory with `ftdibus.inf` and `ftdiport.inf`. In Electron
 *   apps with bundled drivers, typically `path.join(app.getAppPath(), 'drivers', 'win32')`.
 *
 * @example
 * ```ts
 * import { app } from 'electron';
 * import { join } from 'path';
 * import { installDriver } from 'sunvote-ars-client';
 *
 * await installDriver(join(app.getAppPath(), 'drivers', 'win32'));
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

  for (const inf of infFiles) {
    const infPath = join(driverDir, inf);
    await new Promise<void>((resolve, reject) => {
      execFile(
        'pnputil',
        ['/add-driver', infPath, '/install'],
        { timeout: 30_000 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`Driver install failed (requires Admin): ${stderr || err.message}`));
          } else {
            resolve();
          }
        },
      );
    });
  }

  return true;
}
