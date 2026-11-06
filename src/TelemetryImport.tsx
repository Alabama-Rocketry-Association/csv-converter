import { useEffect, useState } from 'react';
import { prepareTelemetry, type ImportResult } from './telemetryParser';

interface Props { onPlot: (file: File) => void; }

export default function TelemetryImport({ onPlot }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [map, setMap] = useState<File | null>(null);
  const [interval, setInterval] = useState(50);
  const [maxAge, setMaxAge] = useState(200);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    if (!result?.converted) { setDownloadUrl(''); return; }
    const url = URL.createObjectURL(result.file);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  async function convert() {
    if (!file) return;
    setBusy(true); setProgress(0); setResult(null); setError('');
    try {
      const output = await prepareTelemetry(file, map, interval, maxAge, setProgress);
      setResult(output);
      onPlot(output.file);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border border-base-300 p-4 mb-6 space-y-3">
      <h2 className="font-semibold text-xl">Import telemetry</h2>
      <p className="text-sm opacity-75">Open a wide CSV, a long-form CSV, a GDS .log, or an onboard .bin file. Conversion runs locally in your browser.</p>
      <div className="flex flex-col lg:flex-row gap-3">
        <label className="flex-1 text-sm">Telemetry file
          <input className="file-input file-input-bordered w-full" type="file" accept=".csv,.log,.txt,.bin" onChange={e => {
            const picked = e.target.files?.[0] || null;
            setFile(picked); setResult(null); setError('');
          }} />
        </label>
        <label className="flex-1 text-sm">Channel map (required for .bin)
          <input className="file-input file-input-bordered w-full" type="file" accept=".csv" onChange={e => {
            setMap(e.target.files?.[0] || null); setResult(null);
          }} />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Output interval (ms)
          <input className="input input-bordered w-32 block" type="number" min={1} max={60000} step={1} value={interval} onChange={e => setInterval(Number(e.target.value))} />
        </label>
        <label className="text-sm">Max sample age (ms)
          <input className="input input-bordered w-32 block" type="number" min={0} max={600000} step={1} value={maxAge} onChange={e => setMaxAge(Number(e.target.value))} />
        </label>
        <button type="button" disabled={!file || busy} className="btn btn-primary" onClick={convert}>
          {busy ? `Processing ${Math.round(progress * 100)}%` : 'Load and plot'}
        </button>
        {downloadUrl && <a className="btn btn-outline" href={downloadUrl} download={result?.file.name}>Download wide CSV</a>}
      </div>
      {error && <p role="alert" className="text-error text-sm">{error}</p>}
      {result?.converted && <p className="text-sm">Converted {result.measurements.toLocaleString()} measurements across {result.channels} channels; {result.events} events, {result.rejected} rejected records. {result.warning || ''}</p>}
      {result && !result.converted && <p className="text-sm">Wide-format CSV loaded without conversion.</p>}
    </section>
  );
}

