/** MATLAB Level 5 MAT-file writer: no backend, npm dependency, or resampling. */
export type TelemetryRow = Record<string, string | number | null | undefined>;

const utf8 = new TextEncoder();
const align8 = (n: number) => (n + 7) & ~7;
const reserved = new Set(['for', 'while', 'if', 'else', 'elseif', 'end', 'function', 'switch', 'case', 'otherwise', 'try', 'catch', 'classdef', 'properties', 'methods', 'events', 'return', 'break', 'continue', 'global', 'persistent', 'parfor', 'spmd']);

export function numericValue(value: string | number | null | undefined): number {
  if (value === undefined || value === null || value === '') return NaN;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : NaN;
}

/** Produce unique, MATLAB-compatible identifiers, preserving simple sensor names. */
export function matlabNames(channels: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Set(['time_s', 'timestamp_s']);
  for (const original of channels) {
    let name = original.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(name) || reserved.has(name)) name = `ch_${name}`;
    name = name.slice(0, 63);
    let candidate = name;
    for (let i = 2; used.has(candidate); ++i) {
      const suffix = `_${i}`;
      candidate = name.slice(0, 63 - suffix.length) + suffix;
    }
    used.add(candidate);
    names.set(original, candidate);
  }
  return names;
}

function tag(view: DataView, offset: number, type: number, size: number) {
  view.setUint32(offset, type, true);
  view.setUint32(offset + 4, size, true);
}

// MATLAB v5 miMATRIX / mxDOUBLE_CLASS, one real double column per variable.
function variableHeader(name: string, rowCount: number): Uint8Array {
  const nameBytes = utf8.encode(name);
  const nameLength = align8(nameBytes.length);
  const bytes = 56 + nameLength;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  tag(view, 0, 14, 48 + nameLength + 8 * rowCount); // miMATRIX
  tag(view, 8, 6, 8); // array flags: miUINT32
  view.setUint32(16, 6, true); // mxDOUBLE_CLASS
  tag(view, 24, 5, 8); // dimensions: miINT32
  view.setInt32(32, rowCount, true);
  view.setInt32(36, 1, true);
  tag(view, 40, 1, nameBytes.length); // name: miINT8
  out.set(nameBytes, 48);
  tag(view, 48 + nameLength, 9, 8 * rowCount); // real data: miDOUBLE
  return out;
}

function matlabHeader(): Uint8Array {
  const out = new Uint8Array(128);
  out.fill(32, 0, 116);
  const description = utf8.encode('MATLAB 5.0 MAT-file, Platform: ARA telemetry browser exporter');
  out.set(description.subarray(0, 116), 0);
  const view = new DataView(out.buffer);
  view.setUint16(124, 0x0100, true);
  out[126] = 0x49; // I
  out[127] = 0x4d; // M, little-endian
  return out;
}

/** Generate a valid MAT v5 file, avoiding one giant interleaved data matrix. */
export function createMatlabFile(rows: TelemetryRow[], timeKey: string, channels: string[]): Blob {
  if (!rows.length) throw new Error('No rows to export.');
  const first = numericValue(rows[0][timeKey]);
  if (!Number.isFinite(first)) throw new Error('Invalid first timestamp.');
  // Keep exports bounded on browsers that already hold a large chart in memory.
  const estimated = 128 + (channels.length + 2) * (128 + rows.length * 8);
  if (estimated > 384 * 1024 * 1024) throw new Error('MATLAB export exceeds the 384 MiB browser safety limit. Export fewer channels or a shorter time range.');
  const parts: BlobPart[] = [matlabHeader()];
  const names = matlabNames(channels);
  const variables: Array<[string, (row: TelemetryRow) => number]> = [
    ['timestamp_s', row => numericValue(row[timeKey])],
    ['time_s', row => numericValue(row[timeKey]) - first],
    ...channels.map((channel): [string, (row: TelemetryRow) => number] => [names.get(channel)!, row => numericValue(row[channel])]),
  ];
  // 32-bit MAT v5 length fields; protect browser memory on oversized exports.
  if (rows.length * 8 > 0x7fffffff) throw new Error('MATLAB export is too large for MAT-file v5.');
  for (const [name, value] of variables) {
    parts.push(variableHeader(name, rows.length));
    const bytes = new Uint8Array(rows.length * 8);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < rows.length; i++) view.setFloat64(i * 8, value(rows[i]), true);
    parts.push(bytes);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

function csvCell(s: string): string { return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

/** Wide CSV with a relative clock and full, un-decimated original rows. */
export function createAnalysisCsv(rows: TelemetryRow[], timeKey: string, channels: string[]): Blob {
  if (!rows.length) throw new Error('No rows to export.');
  const first = numericValue(rows[0][timeKey]);
  const chunks: string[] = [
    ['timestamp_s', 'time_s', ...channels, 'messages'].map(csvCell).join(',') + '\r\n',
  ];
  const pending: string[] = [];
  for (const row of rows) {
    const stamp = numericValue(row[timeKey]);
    const cells = [
      Number.isFinite(stamp) ? stamp.toFixed(6) : '',
      Number.isFinite(stamp) ? (stamp - first).toFixed(6) : '',
      ...channels.map(channel => {
        const val = numericValue(row[channel]);
        return Number.isFinite(val) ? String(val) : '';
      }),
      csvCell(String(row['messages'] || '')),
    ];
    pending.push(cells.join(',') + '\r\n');
    if (pending.length >= 4096) { chunks.push(pending.join('')); pending.length = 0; }
  }
  if (pending.length) chunks.push(pending.join(''));
  return new Blob(chunks, { type: 'text/csv' });
}
