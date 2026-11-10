import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffect, useRef, useState } from 'react';
import { prepareTelemetry, type ImportResult } from './telemetryParser';

interface Props { onPlot: (file: File, name: string) => void; sampleRevision: number; loading: boolean; onBusyChange: (busy: boolean) => void; }

export default function TelemetryImport({ onPlot, sampleRevision, loading, onBusyChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [map, setMap] = useState<File | null>(null);
  const [interval, setInterval] = useState(50);
  const [maxAge, setMaxAge] = useState(200);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    setFile(null);
    setResult(null);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  }, [sampleRevision]);

  useEffect(() => {
    if (!result?.converted) { setDownloadUrl(''); return; }
    const url = URL.createObjectURL(result.file);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  async function convert() {
    if (!file) return;
    setBusy(true); onBusyChange(true); setProgress(0); setResult(null); setError('');
    try {
      const output = await prepareTelemetry(file, map, interval, maxAge, setProgress);
      setResult(output);
      onPlot(output.file, file.name);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); onBusyChange(false); }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">Import telemetry</h2>
      <div className="space-y-4">
        <label className="block text-sm font-medium">Telemetry file
          <Input ref={fileInput} className="mt-1.5 h-9 w-full min-w-0 cursor-pointer text-xs font-normal file:mr-2 file:h-full file:cursor-pointer" type="file" accept=".csv,.log,.txt,.bin" onChange={e => {
            const picked = e.target.files?.[0] || null;
            setFile(picked); setResult(null); setError('');
          }} />
        </label>
        <label className="block text-sm font-medium">Channel map (required for .bin)
          <Input className="mt-1.5 h-9 w-full min-w-0 cursor-pointer text-xs font-normal file:mr-2 file:h-full file:cursor-pointer" type="file" accept=".csv" onChange={e => {
            setMap(e.target.files?.[0] || null); setResult(null);
          }} />
        </label>
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <label className="text-xs font-medium">Output interval (ms)
          <Input className="mt-1.5 block w-full font-normal" type="number" min={1} max={60000} step={1} value={interval} onChange={e => setInterval(Number(e.target.value))} />
        </label>
        <label className="text-xs font-medium">Max sample age (ms)
          <Input className="mt-1.5 block w-full font-normal" type="number" min={0} max={600000} step={1} value={maxAge} onChange={e => setMaxAge(Number(e.target.value))} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="w-full" type="button" disabled={!file || busy || loading} onClick={convert}>
          {busy ? <>Processing <span className="tabular">{Math.round(progress * 100)}%</span></> : 'Load and plot'}
        </Button>
        {downloadUrl && <Button className="w-full" asChild variant="outline"><a href={downloadUrl} download={result?.file.name}>Download wide CSV</a></Button>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {result?.converted && <p className="tabular text-sm">Converted {result.measurements.toLocaleString()} measurements across {result.channels} channels; {result.events} events, {result.rejected} rejected records. {result.warning || ''}</p>}
    </section>
  );
}
