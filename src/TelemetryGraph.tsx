import { useEffect, useRef, type ComponentProps } from 'react';
import { Line } from 'react-chartjs-2';
import type { Chart as ChartJS } from 'chart.js';
import 'chartjs-plugin-zoom';

// The zoom plugin's built-in wheel modifierKey supports only ONE modifier.
// Handle wheel capture once and use its imperative API for axis-specific zoom.
type Props = ComponentProps<typeof Line> & {
  onViewportChange: (chart: ChartJS<'line'>) => void;
};

export default function TelemetryGraph({ onViewportChange, ...lineProps }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartJS<'line'> | null>(null);
  const latestCallback = useRef(onViewportChange);
  latestCallback.current = onViewportChange;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      const chart = chartRef.current;
      if (!chart) return;
      // In particular, Ctrl+wheel must not zoom the whole browser page.
      event.preventDefault();
      event.stopImmediatePropagation();
      // On some systems Shift+wheel is reported as horizontal (deltaX).
      const delta = event.deltaY || (event.shiftKey ? event.deltaX : 0);
      if (!delta) return;
      // Firefox uses line deltas; trackpads generally use pixel deltas.
      const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
      const amount = Math.min(4, Math.abs(delta) / unit);
      const factor = Math.pow(1.12, Math.sign(-delta) * amount);
      // Ctrl takes precedence if both modifiers are held.
      const mode = event.ctrlKey ? 'y' : event.shiftKey ? 'x' : 'xy';
      const rect = chart.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const focalPoint = {
        x: (event.clientX - rect.left) * (chart.width / rect.width),
        y: (event.clientY - rect.top) * (chart.height / rect.height),
      };
      chart.zoom({
        x: mode === 'y' ? 1 : factor,
        y: mode === 'x' ? 1 : factor,
        focalPoint,
      }, 'none');
      latestCallback.current(chart);
    }
    // A native non-passive capture listener is necessary: React wheel listeners
    // can be passive, and the zoom plugin also registers a wheel listener.
    element.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => element.removeEventListener('wheel', wheel, true);
  }, []);

  return <div ref={root}><Line ref={chartRef} {...lineProps} /></div>;
}
