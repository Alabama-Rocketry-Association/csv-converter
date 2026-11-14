import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const formats = [
  {
    name: 'Spreadsheet CSV',
    ext: '.csv',
    body: 'Time in seconds in the first column (named time or timestamp), then one column per channel. If there is a messages column, its entries show up as events.',
  },
  {
    name: 'Log file',
    ext: '.csv .log .txt',
    body: 'One reading per line: time, name, value. Lines whose name starts with log_ show up as events.',
  },
  {
    name: 'Flight computer file',
    ext: '.bin',
    body: 'Also choose the channels file that was saved with it. Its name ends in _channels.csv.',
  },
];

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <section id="help" aria-labelledby="help-title" className="mb-4 rounded-lg border bg-card text-sm">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 id="help-title" className="font-semibold">Help</h2>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Close help"><X /></Button>
      </div>
      <div className="grid gap-x-10 gap-y-6 p-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-semibold">How to use</h3>
          <ol className="list-decimal space-y-2 pl-5 leading-relaxed marker:text-muted-foreground">
            <li>Pick a file and press <span className="font-medium">Load and plot</span>. You can also open one from <span className="font-medium">Sample files</span>.</li>
            <li>Tick the channels you want on the graph.</li>
            <li>Scroll to zoom and drag to move around. Hold Shift and drag to zoom into an area.</li>
            <li>The CSV and MATLAB buttons save only the ticked channels.</li>
          </ol>
          <h3 className="mb-2 mt-5 font-semibold">Converting logs</h3>
          <p className="leading-relaxed">Log and .bin files are turned into rows at a fixed spacing, set by <span className="font-medium">Output interval</span>. <span className="font-medium">Max sample age</span> is how long a reading keeps being repeated in later rows before the cell is left empty.</p>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Files you can open</h3>
          <dl className="divide-y">
            {formats.map(format => (
              <div key={format.name} className="py-2.5 first:pt-0 last:pb-0">
                <dt className="flex flex-wrap items-baseline gap-x-2 font-medium">
                  {format.name}
                  <span className="text-xs font-normal text-muted-foreground">{format.ext}</span>
                </dt>
                <dd className="mt-1 leading-relaxed">{format.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 leading-relaxed">Times in log and .bin files need to be Unix time (seconds since 1970).</p>
        </div>
      </div>
    </section>
  );
}
