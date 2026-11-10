import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect, useRef, useMemo } from "react";
import { Line } from "react-chartjs-2";
import Papa from "papaparse";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Interaction,
  type Chart,
  type InteractionModeFunction,
  type TooltipItem,
} from "chart.js";

import zoomPlugin from "chartjs-plugin-zoom";
import Navbar from "./components/Navbar";
import TelemetryImport from "./TelemetryImport";
import TelemetryExport from "./TelemetryExport";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin
);

ChartJS.defaults.font.family =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

interface DataPoint {
  [key: string]: string | number;
}

type TelemetryChartPoint = { x: number; y: number | null; message: string | number | null };
type TelemetryChart = ChartJS<"line", TelemetryChartPoint[], unknown>;

declare module "chart.js" {
  interface InteractionModeMap { eventIndex: InteractionModeFunction }
}

// Prefer an event marker under the pointer, while retaining the shared X-axis tooltip.
Interaction.modes.eventIndex = (chart, event, options, useFinalPosition) => {
  if (event.x == null || event.y == null) return Interaction.modes.index(chart, event, options, useFinalPosition);
  const position = { x: event.x, y: event.y };
  const eventPoints = Interaction.modes.point(chart, event, { ...options, axis: "xy", intersect: true }, useFinalPosition)
    .filter(item => {
      const raw = chart.data.datasets[item.datasetIndex].data[item.index];
      return raw != null && typeof raw === "object" && "message" in raw && !!raw.message;
    });
  if (eventPoints.length === 0) return Interaction.modes.index(chart, event, options, useFinalPosition);
  eventPoints.sort((a, b) => {
    const distance = (item: typeof a) => {
      const center = (item.element as PointElement).getCenterPoint(useFinalPosition);
      return (center.x - position.x) ** 2 + (center.y - position.y) ** 2;
    };
    return distance(a) - distance(b);
  });
  const { index } = eventPoints[0];
  return chart.getSortedVisibleDatasetMetas().flatMap(meta => {
    const element = meta.data[index] as PointElement | undefined;
    return element && !element.skip ? [{ element, datasetIndex: meta.index, index }] : [];
  });
};

// Evenly spread hues, softer than full-saturation neon, readable in light and dark.
const channelColor = (index: number, dark: boolean) =>
  `hsl(${Math.round((index * 137.508) % 360)}, ${dark ? 70 : 62}%, ${dark ? 64 : 42}%)`;

const chartTheme = (dark: boolean) => ({
  text: dark ? "#a4abb8" : "#4a5160",
  grid: dark ? "rgba(228, 231, 236, 0.10)" : "rgba(27, 32, 41, 0.08)",
  surface: dark ? "#151920" : "#ffffff",
});

interface CSVFile {
  name: string;
  url: string;
  path: string;      // full relative path in the repo
  folder: string;    // derived folder name (optional)
}

const GITHUB_API_ROOT =
  "https://api.github.com/repos/Alabama-Rocketry-Association/csv-converter/contents/TestData";

export const fetchCSVFiles = async (): Promise<CSVFile[]> => {
  const fetchCSVFilesRecursive = async (path: string): Promise<CSVFile[]> => {
    try {
      const response = await fetch(`${GITHUB_API_ROOT}${path ? `/${path}` : ""}`);
      if (!response.ok) throw new Error(`Failed to fetch contents of: ${path}`);

      const items = await response.json();
      let results: CSVFile[] = [];

      for (const item of items) {
        if (item.type === "dir") {
          const subfolderFiles = await fetchCSVFilesRecursive(item.path.replace("TestData/", ""));
          results = results.concat(subfolderFiles);
        } else if (item.name.endsWith(".csv")) {
          try {
          const fullFolderPath = item.path.includes("/")
            ? item.path.substring(0, item.path.lastIndexOf("/"))
            : "";
          
          const folder = fullFolderPath.startsWith("TestData/")
            ? fullFolderPath.replace("TestData/", "")
            : fullFolderPath;
          
            results.push({
              name: item.name,
              url: item.download_url,
              path: item.path,
              folder,
            });
          } catch (err) {
            console.error(`Failed to parse CSV ${item.name}:`, err);
          }
        }
      }

      return results;
    } catch (err) {
      console.error("Recursive fetch failed:", err);
      return [];
    }
  };

  return await fetchCSVFilesRecursive("");
};


function App() {
  const [data, setData] = useState<DataPoint[] | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const chartRef = useRef<ChartJS<'line', { x: number; y: number | null; message: string | number | null }[], unknown> | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [selectedVariables, setSelectedVariables] = useState<Set<string>>(new Set());
  const [minimum, setMinimum] = useState<number>(0);
  const [maximum, setMaximum] = useState<number>(Infinity);
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const [sampleRevision, setSampleRevision] = useState(0);
  const [loadedName, setLoadedName] = useState("");

  const [dependentVariable, setDependentVariable] = useState<string>("");
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);

  const [visibleMin, setVisibleMin] = useState<number>(0);
  const [visibleMax, setVisibleMax] = useState<number>(0);


  const [fixedMin, setFixedMin] = useState<number>();
  const [fixedMax, setFixedMax] = useState<number>();

  const [isZoomX, setIsZoomX] = useState<boolean>(true);
  const [isZoomY, setIsZoomY] = useState<boolean>(true);

  const [isDark, setIsDark] = useState<boolean>(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // const [globalMin, setGlobalMin] = useState<number>(0);
  // const [globalMax, setGlobalMax] = useState<number>(Infinity);


  useEffect(() => {
    fetchCSVFiles().then((files) => {
      // console.log("Fetched CSV files:", files);
      setCsvFiles(files);
      setSamplesLoading(false);
    });
  }, []);


  const handleChange = (chart: TelemetryChart) => {
    const xScale = chart.scales["x"];
    const yScale = chart.scales["y"];
  
    if (!xScale || !yScale) return;
  
    const currentMin = xScale.min;
    const currentMax = xScale.max;

    // Debounce state updates
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setVisibleMin(currentMin);
      setVisibleMax(currentMax);
      setMinimum(currentMin);
      setMaximum(currentMax);
      setFixedMax(yScale.max);
      setFixedMin(yScale.min);
    }, 15);
  };
  
  
  const handleFileUpload = async (input: File | string, name?: string) => {
    setLoading(true);
    setProgress(0);
    setLoadError("");
    try {

      let text = "";

      if (typeof input === "string") {
        // Case: Fetch CSV from GitHub URL
        const response = await fetch(input);
        if (!response.ok) throw new Error("Failed to fetch CSV file.");
        text = await response.text();
      } else {
        // Case: Read local file upload
        text = await input.text();
      }

      const lines = text.split("\n").map((line) => line.trim()).filter(line => line !== "");

      if (lines.length < 2) throw new Error("The file has no data rows.");
      const parseRow = (line: string) => line.includes('"') ? Papa.parse<string[]>(line).data[0] : line.split(",");
      const header = parseRow(lines[0].replace(/^\uFEFF/, ""));
      if (header.length < 2 || !header[0]) throw new Error("The file needs a time column and at least one channel.");
      const messageIndex = header.indexOf("messages");
      const chunkSize = 5000;
      const totalLines = lines.length;
      let currentLine = 1;
      const allData: DataPoint[] = [];

      const processChunk = () => {
        const chunk = lines.slice(currentLine, currentLine + chunkSize);
        currentLine += chunkSize;

        chunk.forEach((row) => {
          const values = parseRow(row);
          const rowData: DataPoint = {};
          header.forEach((key, index) => {
            if (index === messageIndex || (messageIndex >= 0 && index > messageIndex && key === "_")) return;
            const value = values[index] ?? "";
            const numeric = value.trim() === "" ? NaN : Number(value);
            rowData[key] = Number.isFinite(numeric) ? numeric : value;
          });
          if (messageIndex >= 0) {
            // Older exports put additional events in unnamed columns after `messages`.
            rowData.messages = values.filter((_, index) =>
              index === messageIndex || (index > messageIndex && (index >= header.length || header[index] === "_"))
            ).map(value => value.trim()).filter(Boolean).join(", ");
          }
          allData.push(rowData);
        });

        setProgress(Math.min((currentLine / totalLines) * 100, 100));

        if (currentLine < totalLines) {
          setTimeout(processChunk, 0);
        } else {
          // Binary search in the graph requires valid, ordered timestamps.
          const timeKey = header[0];
          const orderedData = allData.filter(row => typeof row[timeKey] === "number" && Number.isFinite(row[timeKey]));
          if (orderedData.some((row, index) => index > 0 && (row[timeKey] as number) < (orderedData[index - 1][timeKey] as number))) {
            orderedData.sort((a, b) => (a[timeKey] as number) - (b[timeKey] as number));
          }
          const firstTime = orderedData[0]?.[header[0]];
          const lastTime = orderedData[orderedData.length - 1]?.[header[0]];
          if (typeof firstTime !== "number" || !Number.isFinite(firstTime) ||
              typeof lastTime !== "number" || !Number.isFinite(lastTime)) {
            setLoadError("The first column must contain numeric timestamps.");
            setLoading(false);
            return;
          }
          const firstChannel = header.slice(1).find(key => key !== "messages" && key !== "_" && orderedData.some(row => typeof row[key] === "number" && Number.isFinite(row[key])));
          setDependentVariable(header[0]);
          setData(orderedData);
          setDataRevision(value => value + 1);
          const filename = typeof input === "string" ? decodeURIComponent(input.split("/").pop() || "Sample file") : input.name;
          setLoadedName(name || filename);
          setSelectedVariables(new Set(firstChannel ? [firstChannel] : []));
          setMinimum(0);
          setMaximum(Infinity);
          setFixedMin(undefined);
          setFixedMax(undefined);
          setVisibleMin(0);
          setLoading(false);

          const initialTimestamp = firstTime;
          // setGlobalMin(0);
          const finalTimestamp = lastTime;
          // setGlobalMax(finalTimestamp - initialTimestamp);
          const duration = finalTimestamp - initialTimestamp;
          setVisibleMax(duration > 0 ? duration : 1);
          setSecondsElapsed(duration > 0 ? duration : 1);
        }
      };
      processChunk();
    } catch (error) {
      console.error("Error processing CSV:", error);
      setLoadError(error instanceof Error ? error.message : "Could not load the file.");
      setLoading(false);
    }
  };


  const resetZoom = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    chartRef.current?.resetZoom();
    setMinimum(0);
    setMaximum(Infinity);
    setVisibleMin(0);
    setVisibleMax(secondsElapsed > 0 ? secondsElapsed : 1);
    setFixedMin(undefined);
    setFixedMax(undefined);
  };

  const moveTimeWindow = (start: number) => {
    const chart = chartRef.current;
    const windowSize = visibleMax - visibleMin;
    const nextStart = Math.max(0, Math.min(start, secondsElapsed - windowSize));
    const nextEnd = nextStart + windowSize;
    if (chart) {
      chart.zoomScale('x', { min: nextStart, max: nextEnd }, 'none');
      handleChange(chart);
    }
  };

  const zoomGraph = (factor: number) => {
    const chart = chartRef.current;
    if (!chart || (!isZoomX && !isZoomY)) return;
    chart.zoom({ x: isZoomX ? factor : 1, y: isZoomY ? factor : 1 }, 'none');
    handleChange(chart);
  };

  const toggleVariable = (variable: string) => {
    setFixedMin(undefined);
    setFixedMax(undefined);
    setSelectedVariables((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(variable)) {
        newSelected.delete(variable);
      } else {
        newSelected.add(variable);
      }
      return newSelected;
    });
  };

  const filteredData = useMemo(() => {
    if (!data || !dependentVariable || selectedVariables.size === 0) return [];
    const initialTimestamp = data[0][dependentVariable] as number;
    const startTime = minimum + initialTimestamp;
    const endTime = maximum + initialTimestamp;
    const bound = (target: number, afterEqual = false) => {
      let low = 0;
      let high = data.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const time = data[middle][dependentVariable] as number;
        if (time < target || (afterEqual && time === target)) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    // Timestamps are ordered, so locate the visible window without scanning the full file.
    const startIndex = Math.max(0, bound(startTime) - 1);
    const endIndex = Number.isFinite(endTime) ? Math.min(data.length, bound(endTime, true) + 1) : data.length;
    const inRange = data.slice(startIndex, endIndex);

    // Sample to the chart's pixel width: zoomed-out views stay light, while zooming in reveals detail.
    const plotWidth = chartRef.current?.chartArea.width ?? Math.min(window.innerWidth * 0.65, 1000);
    const bucketCount = Math.max(1, Math.floor(plotWidth / 2));
    const bucketSize = Math.max(1, Math.ceil(inRange.length / bucketCount));
    // Keep extrema, validity transitions, and events so spikes and event markers survive sampling.
    const filteredData: DataPoint[] = [];
    for (let start = 0; start < inRange.length; start += bucketSize) {
      const end = Math.min(start + bucketSize, inRange.length);
      const keep = new Set<number>([start, end - 1]);
      for (const key of selectedVariables) {
        let min = Infinity, max = -Infinity, minIndex = -1, maxIndex = -1;
        for (let i = start; i < end; i++) {
          const value = inRange[i][key];
          const valid = typeof value === "number" && Number.isFinite(value);
          if (i > 0) {
            const previous = inRange[i - 1][key];
            const previousValid = typeof previous === "number" && Number.isFinite(previous);
            if (valid !== previousValid) { if (i > start) keep.add(i - 1); keep.add(i); }
          }
          if (!valid) continue;
          if (value < min) { min = value; minIndex = i; }
          if (value > max) { max = value; maxIndex = i; }
        }
        if (minIndex >= 0) keep.add(minIndex);
        if (maxIndex >= 0) keep.add(maxIndex);
      }
      for (let i = start; i < end; i++) if (inRange[i].messages) keep.add(i);
      [...keep].sort((a, b) => a - b).forEach(index => filteredData.push(inRange[index]));
    }

    return filteredData;
  }, [data, dependentVariable, minimum, maximum, selectedVariables]);

  const renderGraph = () => {
    if (!data) return <p className="py-16 text-center text-muted-foreground">No data to display</p>;

    if (selectedVariables.size === 0) return <p className="py-16 text-center text-muted-foreground">Select a channel to plot.</p>;

    const theme = chartTheme(isDark);

    if (!Object.prototype.hasOwnProperty.call(data[0], dependentVariable)) {
      return (
        <div role="alert" className="mx-auto mt-4 max-w-xl rounded-md border border-destructive p-3 text-destructive">
          <span><strong className="font-semibold">Error:</strong> No dependent variable field found in the data</span>
        </div>
      );
    }

    const initialTimestamp = (data[0][dependentVariable] as number);

      if (filteredData.length === 0) {
        return (
          <Line
            data={{
              labels: [visibleMin, visibleMax],
              datasets: [
                {
                  label: "No data in this range",
                  data: [null, null],
                  borderColor: "rgba(200, 200, 200, 0.3)",
                  borderWidth: 2,
                  pointRadius: 0,
                  fill: false,
                },
              ],
            }}
          
          />
        );
      }

    const labels = filteredData.map((point) => (point[dependentVariable] as number) - initialTimestamp);
    const messages = filteredData.map((point) => (point["messages"] ? point["messages"] : null));

    const allChannels = Object.keys(filteredData[0]).filter((key) => key !== dependentVariable && key !== "messages");

    const datasets = Object.keys(filteredData[0])
      .filter((key) => key !== dependentVariable && key !== "messages" && selectedVariables.has(key))
      .map((key) => {
        const color = channelColor(allChannels.indexOf(key), isDark);
        return {
          label: key,
          data: filteredData.map((point, idx) => ({
            x: (point[dependentVariable] as number) - initialTimestamp,
            y: typeof point[key] === 'number' && Number.isFinite(point[key]) ? point[key] as number : null,
            message: messages[idx]
          })),
          borderColor: color,
          borderWidth: 1.75,

          backgroundColor: color,
          pointBackgroundColor: theme.surface,
          pointBorderColor: color,
          pointBorderWidth: 2,
          pointRadius: filteredData.map((point) => (point["messages"] ? 6 : filteredData.length === 1 ? 3 : 0)),
          pointHoverRadius: 8,
          pointHitRadius: 10,
        };
      });

    const chartData = {
      labels,
      datasets,
    };

    const options = {
      responsive: true,
      animation: false as const,
      color: theme.text,
      interaction: { mode: 'eventIndex' as const, intersect: false, axis: 'x' as const },
      plugins: {
        legend: {
          position: "top" as const,
          labels: { color: theme.text, usePointStyle: true, pointStyle: "line" as const },
          onClick: () => {},
        },
        zoom: {
          limits: { x: { min: 0, max: secondsElapsed } },
          zoom: {
            wheel: {
              enabled: isZoomX || isZoomY,
            },
            pinch: {
              enabled: isZoomX || isZoomY,
            },
            drag:{
              enabled: isZoomX || isZoomY,
              modifierKey: "shift" as const,
            },
            mode: isZoomX && isZoomY ? "xy" : isZoomX ? "x" : isZoomY ? "y" : (undefined as "x" | "y" | "xy" | undefined),
            onZoom: ({ chart }: { chart: Chart }) => handleChange(chart as TelemetryChart),
          },
          pan: {
            enabled: true,
            mode: "xy" as const,
            threshold: 5,
            onPan: ({ chart }: { chart: Chart }) => handleChange(chart as TelemetryChart),
          },
        },
        tooltip: {
          mode: 'eventIndex' as const,
          intersect: false as const,
          axis: 'x' as const,
          filter: (item: TooltipItem<"line">) => {
            const raw = item.raw;
            if (raw == null) return false;
            if (typeof raw !== 'object' || !('y' in raw)) return true;
            return (raw as { y?: number | null }).y != null;
          },
          backgroundColor: isDark ? "#e4e7ec" : "#1d222c",
          titleColor: isDark ? "#151920" : "#ffffff",
          bodyColor: isDark ? "#151920" : "#ffffff",
          footerColor: isDark ? "#151920" : "#ffffff",
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: function (tooltipItem: TooltipItem<"line">) {
              const point = tooltipItem.raw as { y: number | null; message?: string | number | null };
              return `${tooltipItem.dataset.label}: ${point.y}`;
            },
            footer: function (items: TooltipItem<"line">[]) {
              const point = items.find(item => item.raw && typeof item.raw === "object" && "message" in item.raw)?.raw as TelemetryChartPoint | undefined;
              return point?.message
                ? (`Event: ${point.message}`.match(/.{1,36}(?:\s|$)|\S{1,36}/g) ?? []).map(line => line.trim())
                : [];
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Time (s)",
            color: theme.text,
          },
          type: "linear" as const,
          min: visibleMin,
          max: visibleMax,
          grid: { color: theme.grid },
          border: { color: theme.grid },
          ticks: {
            color: theme.text,
            callback: (value: string | number) =>
              typeof value === "number" ? Number(value.toFixed(2)) : value,
          },
        },
        y: {
          title: {
            display: true,
            text: selectedVariables.size === 1 ? [...selectedVariables][0] : "Value",
            color: theme.text,
          },
          min: fixedMin,
          max: fixedMax,
          grid: { color: theme.grid },
          border: { color: theme.grid },
          ticks: { color: theme.text },
        },
      },
    };

    return <Line ref={chartRef} data={chartData} options={options} role="img" aria-label={`Telemetry plot of ${[...selectedVariables].join(", ")} against time in seconds`} />;
  };

  const renderVariableCheckboxes = () => {
    if (!data || data.length === 0) return null;

    const availableVariables = Object.keys(data[0]).filter((key) => key !== dependentVariable && key !== "messages");

    return (
      <div>
        <h2 className="mb-3 text-sm font-semibold">Channels</h2>
        <div className="max-h-[45vh] space-y-0.5 overflow-y-auto">
          {availableVariables.map((variable, index) => (
            <label key={variable} htmlFor={variable} className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-accent">
              <Checkbox
                id={variable}
                checked={selectedVariables.has(variable)}
                style={{ borderColor: channelColor(index, isDark), color: '#fff', backgroundColor: selectedVariables.has(variable) ? channelColor(index, isDark) : 'transparent' }}
                onCheckedChange={() => toggleVariable(variable)}
              />
              <span className="truncate">{variable}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar data={csvFiles} loading={samplesLoading} busy={loading || importBusy} onSelect={(url) => { setSampleRevision(value => value + 1); void handleFileUpload(url); }} />
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col md:flex-row">
        <aside aria-label="Telemetry controls" className="w-full shrink-0 border-b p-4 md:w-80 md:border-b-0 md:border-r md:p-5">
          <TelemetryImport onPlot={handleFileUpload} sampleRevision={sampleRevision} loading={loading} onBusyChange={setImportBusy} />
          {data && data.length > 0 && <div className="mt-6 border-t pt-5">{renderVariableCheckboxes()}</div>}
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {data && <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-all text-sm font-medium">{loadedName}</span>
            <TelemetryExport key={dataRevision} data={data} timeKey={dependentVariable} selectedChannels={selectedVariables}
              visibleMin={visibleMin} visibleMax={visibleMax} />
          </div>}
          <section aria-label="Graph" className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-end gap-3 border-b px-4 py-3">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  X zoom
                  <Switch checked={isZoomX} onCheckedChange={setIsZoomX} aria-label="X Zoom" />
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  Y zoom
                  <Switch checked={isZoomY} onCheckedChange={setIsZoomY} aria-label="Y Zoom" />
                </label>
                {data && <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => zoomGraph(1.25)} disabled={selectedVariables.size === 0 || (!isZoomX && !isZoomY)}>Zoom in</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => zoomGraph(0.8)} disabled={selectedVariables.size === 0 || (!isZoomX && !isZoomY)}>Zoom out</Button>
                  <Button type="button" variant="outline" size="sm" onClick={resetZoom}>Reset</Button>
                </div>}
              </div>
            </div>
            <div className="p-4">
              {loading && (
                <div className="mb-4" role="status">
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>Loading data...</span><span className="tabular">{Math.round(progress)}%</span>
                  </div>
                  <progress className="h-2 w-full overflow-hidden rounded-full accent-foreground" value={progress} max={100} />
                </div>
              )}
              {loadError && <p role="alert" className="mb-4 rounded-md border border-destructive p-3 text-sm text-destructive">{loadError}</p>}
              {renderGraph()}
              {data && <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t pt-3">
                <span className="tabular text-xs text-muted-foreground">0 s</span>
                <label className="sr-only" htmlFor="time-window-position">X position</label>
                <input
                  id="time-window-position"
                  aria-label="X position"
                  type="range"
                  min={0}
                  max={Math.max(0, secondsElapsed - (visibleMax - visibleMin))}
                  step={Math.max((secondsElapsed - (visibleMax - visibleMin)) / 1000, 0.001)}
                  value={Math.min(visibleMin, Math.max(0, secondsElapsed - (visibleMax - visibleMin)))}
                  disabled={secondsElapsed <= visibleMax - visibleMin}
                  onChange={event => moveTimeWindow(Number(event.target.value))}
                  className="h-6 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
                />
                <span className="tabular text-xs text-muted-foreground">{secondsElapsed.toFixed(2)} s</span>
              </div>}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
