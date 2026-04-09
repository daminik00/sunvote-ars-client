import type { PortInfo } from './types.js';

const FTDI_VENDOR_ID = '0403';

/**
 * List all available serial ports.
 */
export async function listPorts(): Promise<PortInfo[]> {
  const { SerialPort } = await import('serialport');
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer ?? undefined,
    vendorId: p.vendorId ?? undefined,
    productId: p.productId ?? undefined,
  }));
}

/**
 * Find the first serial port with an FTDI chip (vendorId 0403),
 * which is used by SunVote receivers.
 */
export async function findSunVotePort(): Promise<string | null> {
  const ports = await listPorts();
  const ftdi = ports.find(
    (p) => p.vendorId?.toLowerCase() === FTDI_VENDOR_ID,
  );
  return ftdi?.path ?? null;
}
