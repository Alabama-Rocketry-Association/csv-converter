import { useState } from 'react';
import { createAnalysisCsv, createMatlabFile, matlabNames, numericValue, type TelemetryRow } from './matlabExport';

interface Props {
  data: TelemetryRow[] | null;
  timeKey: string;
  selectedChannels: Set<string>;
  visibleMin: number;
  visibleMax: number;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function TelemetryExport({ data, timeKey, selectedChannels, visibleMin, visibleMax }: Props) {
  const [scope, setScope] = useState<'all' | 'visible'>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!data?.length || !timeKey) return null;

  const channels = Object.keys(data[0]).filter(k => k !== timeKey && k !== 'messages');
  const exportChannels = selectedChannels.size ? channels.filter(k => selectedChannels.has(k)) : channels;

  async function exportAs(format: 'mat' | 'csv') {
    if (!data) return;
    setBusy(true); setError(''); setNotice('');
    try {
      // Give React one frame to paint the busy state before exporting.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const first = numericValue(data[0][timeKey]);
      const rows = scope === 'visible'
        ? data.filter(row => {
            const t = numericValue(row[timeKey]) - first;
            return Number.isFinite(t) && t >= visibleMin - 0.000001 && t <= visibleMax + 0.000001;
          }) : data;
      if (!rows.length) throw new Error('No measurements in the current time range.');
      if (!exportChannels.length) throw new Error('No channels selected for export.');
      const blob = format === 'mat'
        ? createMatlabFile(rows, timeKey, exportChannels)
        : createAnalysisCsv(rows, timeKey, exportChannels);
      download(blob, `ARA_telemetry_${scope === 'visible' ? 'zoom_' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`);
      if (format === 'mat') {
        const changed = [...matlabNames(exportChannels)].filter(([raw, safe]) => raw !== safe).length;
        setNotice(`MATLAB file: ${rows.length.toLocaleString()} rows, ${exportChannels.length} channels. Missing values are NaN.${changed ? ` ${changed} channel names were made MATLAB-compatible.` : ''}`);
      } else {
        setNotice(`CSV file: ${rows.length.toLocaleString()} rows, ${exportChannels.length} channels, plus event messages.`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border border-base-300 p-4 mb-5 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-lg mr-2">Export for analysis</h2>
        <label className="text-sm">Time range
          <select className="select select-bordered select-sm ml-2" value={scope} onChange={e => setScope(e.target.value as 'all' | 'visible')}>
            <option value="all">Entire recording</option>
            <option value="visible">Current zoom window</option>
          </select>
        </label>
        <button type="button" className="btn btn-sm btn-outline" disabled={busy || !exportChannels.length} onClick={() => void exportAs('mat')}>Export MATLAB .mat</button>
        <button type="button" className="btn btn-sm btn-outline" disabled={busy || !exportChannels.length} onClick={() => void exportAs('csv')}>Export CSV</button>
      </div>
      <p className="text-xs opacity-75">Exports {selectedChannels.size ? 'the checked channels' : 'all channels (none checked)'} at the full imported resolution; chart display decimation is not applied. MATLAB export includes time_s (relative), timestamp_s (original) and one numeric variable per channel.</p>
      {busy && <p className="text-sm">Preparing export…</p>}
      {error && <p className="text-sm text-error" role="alert">{error}</p>}
      {notice && <p className="text-sm opacity-80">{notice}</p>}
    </section>
  );
}
