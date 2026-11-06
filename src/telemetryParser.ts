/** Offline telemetry import for the ARA CSV dashboard.
 * Converts long-form GDS telemetry, legacy logs, and 13-byte vehicle records
 * into the existing wide CSV format. Nothing is uploaded to a server.
 */

export type ImportProgress = (fraction: number) => void;
export interface ImportResult {
  file: File;
  converted: boolean;
  measurements: number;
  channels: number;
  events: number;
  rejected: number;
  warning?: string;
}

const RECORD_BYTES = 13; // little-endian <dBf: f64 epoch, u8 ASCII channel, f32 value
const MAX_ROWS = 400_000;
const MAX_CHANNELS = 512;
// Onboard logs use Unix epoch seconds. Reject uninitialized timestamps (0),
// boot-relative clocks, and nonsense dates instead of generating decades of rows.
const MIN_EPOCH_SECONDS = Date.UTC(2000, 0, 1) / 1000;
const MAX_EPOCH_SECONDS = Date.UTC(2100, 0, 1) / 1000;
const validEpoch = (t: number) => Number.isFinite(t) && t >= MIN_EPOCH_SECONDS && t < MAX_EPOCH_SECONDS;


type Sample = { time: number; value: number };
type Bucket = Map<string, Sample>;
const finite = (v: number) => Number.isFinite(v);
const trimmed = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');
const escaped = (s: string) => /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

/** Parse the companion char,name map written by the binary logger. */
export async function readChannelMap(file: File): Promise<Map<number, string>> {
  const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/);
  const names = new Map<number, string>();
  if (lines[0]?.trim().toLowerCase() !== 'char,name') throw new Error('Channel map must start with char,name');
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const comma = line.indexOf(',');
    if (comma === -1) throw new Error(`Invalid channel-map line: ${line}`);
    const code = trimmed(line.slice(0, comma));
    const name = trimmed(line.slice(comma + 1));
    if (code.length !== 1 || !name) throw new Error(`Invalid channel-map line: ${line}`);
    if (names.has(code.charCodeAt(0))) throw new Error(`Duplicate channel code ${code}`);
    names.set(code.charCodeAt(0), name);
  }
  if (!names.size) throw new Error('The channel map is empty');
  return names;
}

/** Streaming text reader, so the entire input log is not loaded as a string. */
async function scanLines(file: File, useLine: (line: string) => void, progress?: ImportProgress) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  let pending = '', bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      pending += decoder.decode(value, { stream: true });
      let pos: number;
      while ((pos = pending.indexOf('\n')) !== -1) {
        useLine(pending.slice(0, pos).replace(/\r$/, ''));
        pending = pending.slice(pos + 1);
      }
      progress?.(bytesRead / Math.max(file.size, 1));
    }
    pending += decoder.decode();
    if (pending) useLine(pending);
  } finally { reader.releaseLock(); }
}

function parseHeader(line: string): Record<string, number> | null {
  const parts = line.replace(/^\uFEFF/, '').split(',').map(s => trimmed(s).toLowerCase());
  const columns: Record<string, number> = {};
  parts.forEach((x, i) => { columns[x] = i; });
  if ('value' in columns && ('name' in columns || 'channel' in columns) &&
      ('timestamp' in columns || 'timestamp_s' in columns)) return columns;
  return null;
}

/** Return true if a file is already wide and should use the existing importer unchanged. */
export async function isWideCsv(file: File): Promise<boolean> {
  const prefix = (await file.slice(0, 8192).text()).replace(/^\uFEFF/, '');
  const first = prefix.split(/\r?\n/).find(x => x.trim() && !x.startsWith('#')) || '';
  if (!first) throw new Error('The telemetry file is empty');
  if (parseHeader(first)) return false;
  if (/^\s*(?:[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*,/i.test(first)) return false;
  const header = first.split(',').map(s => trimmed(s).toLowerCase());
  if ((header[0] === 'timestamp' || header[0] === 'timestamp_s' || header[0] === 'time') && header.length > 2) return true;
  throw new Error('Unrecognized telemetry CSV. Expected wide columns or timestamp,name,value');
}

/**
 * Convert a raw log or bin to 50-ms (configurable) wide CSV using bounded-age
 * zero-order hold. Binning keeps the display size proportional to time span,
 * rather than allocating one N-channel row for each asynchronous measurement.
 */
export async function prepareTelemetry(
  file: File, channelMap?: File | null, stepMs = 50, maxAgeMs = 200,
  progress?: ImportProgress
): Promise<ImportResult> {
  if (!(stepMs >= 1 && stepMs <= 60_000 && Number.isInteger(stepMs))) throw new Error('Sampling interval must be an integer between 1 and 60000 ms');
  if (!(maxAgeMs >= 0 && maxAgeMs <= 600_000)) throw new Error('Invalid maximum sample age');
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'csv' && await isWideCsv(file)) {
    progress?.(1);
    return { file, converted: false, measurements: 0, channels: 0, events: 0, rejected: 0 };
  }
  if (!['csv', 'txt', 'log', 'bin'].includes(ext)) throw new Error('Supported inputs: .csv, .log, .txt, .bin');

  const bins = new Map<number, Bucket>();
  const eventBins = new Map<number, string[]>();
  const channels = new Set<string>();
  let first = Infinity, last = -Infinity, measurements = 0, events = 0, rejected = 0;
  let unknownCodes = 0, invalidTimestamps = 0;
  const stampBin = (t: number) => Math.ceil((t * 1000) / stepMs);
  const remember = (time: number, name: string, value: number) => {
    if (!validEpoch(time)) { invalidTimestamps++; rejected++; return; }
    if (!finite(value) || !name) { rejected++; return; }
    const idx = stampBin(time);
    let bucket = bins.get(idx);
    if (!bucket) { bucket = new Map(); bins.set(idx, bucket); }
    const old = bucket.get(name);
    if (!old || old.time <= time) bucket.set(name, { time, value });
    channels.add(name);
    first = Math.min(first, idx); last = Math.max(last, idx); measurements++;
    if (bins.size > MAX_ROWS || channels.size > MAX_CHANNELS) throw new Error('Recording exceeds in-browser conversion limits. Increase the sampling interval or convert offline.');
  };
  const event = (time: number, message: string) => {
    if (!validEpoch(time)) { invalidTimestamps++; rejected++; return; }
    const idx = stampBin(time);
    const list = eventBins.get(idx) || [];
    if (list.length < 8) list.push(message);
    eventBins.set(idx, list);
    first = Math.min(first, idx); last = Math.max(last, idx); events++;
  };

  if (ext === 'bin') {
    if (!channelMap) throw new Error('Choose the matching *_channels.csv file to decode this .bin log.');
    const map = await readChannelMap(channelMap);
    const count = Math.floor(file.size / RECORD_BYTES);
    if (count === 0) throw new Error('Binary file has no complete 13-byte records');
    if (file.size % RECORD_BYTES !== 0) rejected++;
    const chunkRecords = 131_072;
    for (let start = 0; start < count; start += chunkRecords) {
      const end = Math.min(start + chunkRecords, count);
      const buf = await file.slice(start * RECORD_BYTES, end * RECORD_BYTES).arrayBuffer();
      const data = new DataView(buf);
      for (let i = 0; i < end - start; i++) {
        const offset = i * RECORD_BYTES;
        const t = data.getFloat64(offset, true);
        const code = data.getUint8(offset + 8);
        const value = data.getFloat32(offset + 9, true);
        const name = map.get(code);
        if (!name) { unknownCodes++; rejected++; continue; }
        remember(t, name, value);
      }
      progress?.(end / count * 0.85);
    }
  } else {
    let header: Record<string, number> | null = null;
    let started = false;
    await scanLines(file, line => {
      if (!line.trim() || line.startsWith('#')) return;
      if (!started) {
        started = true;
        header = parseHeader(line);
        if (header) return;
      }
      try {
        if (header) {
          const cols = line.split(',');
          const ts = Number(cols[header['timestamp_s'] ?? header['timestamp']]);
          const nm = trimmed(cols[header['channel'] ?? header['name']] || '');
          const vl = Number(cols[header['value']]);
          if (!nm) { rejected++; return; }
          if (nm.startsWith('log_')) event(ts, nm + ': ' + cols.slice(header['value']).join(','));
          else remember(ts, nm, vl);
          return;
        }
        // Raw logs are timestamp,name,value or device,timestamp,name,value.
        // Split only the first two/three commas: event messages may contain commas.
        const c1 = line.indexOf(',');
        const c2 = line.indexOf(',', c1 + 1);
        if (c1 < 0 || c2 < 0) { rejected++; return; }
        let ts = Number(trimmed(line.slice(0, c1)));
        let name: string, content: string;
        if (!finite(ts)) {
          const c3 = line.indexOf(',', c2 + 1);
          if (c3 < 0) { rejected++; return; }
          ts = Number(trimmed(line.slice(c1 + 1, c2)));
          name = trimmed(line.slice(c2 + 1, c3));
          content = line.slice(c3 + 1).trim();
        } else {
          name = trimmed(line.slice(c1 + 1, c2));
          content = line.slice(c2 + 1).trim();
        }
        if (name.startsWith('log_')) event(ts, `${name.slice(4)}: ${trimmed(content)}`);
        else remember(ts, name, Number(trimmed(content)));
      } catch (err) {
        if (err instanceof Error && err.message.includes('exceeds in-browser')) throw err;
        rejected++;
      }
    }, fraction => progress?.(fraction * 0.85));
  }

  if (!measurements) throw new Error(
    `No valid numeric telemetry found. Skipped ${invalidTimestamps} invalid timestamps ` +
    `and ${unknownCodes} unknown channel codes. Confirm that the binary file and channel map match.`
  );
  const rowCount = last - first + 1;
  if (rowCount > MAX_ROWS) {
    const from = new Date(first * stepMs).toISOString();
    const to = new Date(last * stepMs).toISOString();
    throw new Error(`Wide output would have ${rowCount.toLocaleString()} rows (from ${from} to ${to}). ` +
      `Check for outlier timestamps or use a larger output interval.`);
  }
  const names = [...channels].sort();
  const latest = new Map<string, Sample>();
  const pieces: string[] = [`timestamp_s,${names.map(escaped).join(',')},messages\n`];
  let buffer: string[] = [];
  // Keep the same time convention as the existing dashboard: Unix seconds first.
  for (let idx = first; idx <= last; idx++) {
    const at = idx * stepMs / 1000;
    for (const [name, sample] of bins.get(idx) || []) latest.set(name, sample);
    const values = names.map(name => {
      const sample = latest.get(name);
      // Value is held only until its age limit; never fill missing telemetry forever.
      return sample && (at - sample.time) * 1000 <= maxAgeMs + 0.001 && at + 0.000001 >= sample.time
        ? String(sample.value) : '';
    });
    buffer.push(`${at.toFixed(6)},${values.join(',')},${escaped((eventBins.get(idx) || []).join(' | '))}\n`);
    if (buffer.length >= 4096) { pieces.push(buffer.join('')); buffer = []; }
    if ((idx - first) % 4096 === 0) progress?.(0.85 + (idx - first) / rowCount * 0.15);
  }
  if (buffer.length) pieces.push(buffer.join(''));
  progress?.(1);
  const base = file.name.replace(/\.[^.]+$/, '');
  return {
    file: new File(pieces, `${base}_wide.csv`, { type: 'text/csv' }),
    converted: true, measurements, channels: names.length, events, rejected,
    warning: [
      invalidTimestamps ? `Skipped ${invalidTimestamps.toLocaleString()} invalid/uninitialized timestamps.` : '',
      unknownCodes ? `Skipped ${unknownCodes.toLocaleString()} records with unmapped channel IDs.` : '',
    ].filter(Boolean).join(' ') || undefined,
  };
}
