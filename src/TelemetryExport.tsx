import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
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
  const exportChannels = channels.filter(k => selectedChannels.has(k));

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
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="sr-only">Export for analysis</h2>
        <label className="text-sm font-medium"><span className="sr-only">Time range</span>
          <span className="relative block">
            <select className="h-8 cursor-pointer appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-9 text-xs font-normal focus-visible:ring-1 focus-visible:ring-ring" value={scope} onChange={e => setScope(e.target.value as 'all' | 'visible')}>
              <option value="all">Entire recording</option>
              <option value="visible">Current zoom window</option>
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </span>
        </label>
        <Button type="button" size="sm" variant="outline" disabled={busy || !exportChannels.length} onClick={() => void exportAs('mat')}>MATLAB .mat</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || !exportChannels.length} onClick={() => void exportAs('csv')}>CSV</Button>
      </div>
      {busy && <p className="text-sm">Preparing export…</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="tabular text-sm text-muted-foreground">{notice}</p>}
    </section>
  );
}
