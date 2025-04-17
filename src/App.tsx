import { useState, useEffect, useRef } from "react";
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
} from "chart.js";
import "tailwindcss/tailwind.css";
import zoomPlugin, { resetZoom } from "chartjs-plugin-zoom";
import Navbar from "./components/Navbar";

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

interface DataPoint {
  [key: string]: string | number;
}

interface CSVFile {
  name: string;
  url: string;
  content: any[];
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
            const fileRes = await fetch(item.download_url);
            const text = await fileRes.text();

            const parsed = Papa.parse(text, {
              header: true,
              skipEmptyLines: true,
            });

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
              content: parsed.data,
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
  const [selectedVariables, setSelectedVariables] = useState<Set<string>>(new Set());
  const [minimum, setMinimum] = useState<number>(0);
  const [maximum, setMaximum] = useState<number>(Infinity);
  const [csvFiles, setCsvFiles] = useState<CSVFile[]>([]);

  const [dependentVariable, setDependentVariable] = useState<string>("");
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);

  const [visibleMin, setVisibleMin] = useState<number>(0);
  const [visibleMax, setVisibleMax] = useState<number>(0);
  const [visibleRange, setVisibleRange] = useState<number>(1);
  const [sampleRate, setSampleRate] = useState<number>(20);

  const maxResolution = 1;
  const [minResolution, setMinResolution] = useState<number>(100);

  const [fixedMin, setFixedMin] = useState<number>();
  const [fixedMax, setFixedMax] = useState<number>();

  const [globalMin, setGlobalMin] = useState<number>(0);
  const [globalMax, setGlobalMax] = useState<number>(Infinity);

  const [isZoomX, setIsZoomX] = useState<boolean>(true);
  const [isZoomY, setIsZoomY] = useState<boolean>(true);


  useEffect(() => {
    fetchCSVFiles().then((files) => {
      // console.log("Fetched CSV files:", files);
      setCsvFiles(files);
      setLoading(false);
    });
  }, []);

  // Store previous range to compare before updating state
  let debounceTimer: NodeJS.Timeout | null = null;
  
  const handleChange = (chart: any) => {
    const xScale = chart.scales["x"];
    const yScale = chart.scales["y"];
  
    if (!xScale || !yScale) return;
  
    let currentMin = xScale.min;
    let currentMax = xScale.max;
    const range = currentMax - currentMin;

    // Debounce state updates
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newMinRes = Math.ceil((range * sampleRate) / 500);
      if (newMinRes !== minResolution) {
        setMinResolution(newMinRes);
      }
  
      setVisibleMin(currentMin);
      setVisibleMax(currentMax);
      setVisibleRange(range);
      setMinimum(currentMin);
      setMaximum(currentMax);
      setFixedMax(yScale.max);
      setFixedMin(yScale.min);
    }, 15);
  };
  
  
  const calculatedSizeValue = (visibleRange: number, maxResolution: number, minResolution: number) => {
    const rangeRatio = (visibleRange * selectedVariables.size) / (secondsElapsed * maxResolution);
    return minResolution + (maxResolution - minResolution) * (1 - rangeRatio);
  }

  const handleFileUpload = async (input: File | string) => {
    setLoading(true);
    try {

      let text = "";

      if (typeof input === "string") {
        // Case: Fetch CSV from GitHub URL
        const response = await fetch(input);
        if (!response.ok) throw new Error("Failed to fetch CSV file.");
        text = await response.text();
      } else {
        // Case: Read local file upload
        const reader = new FileReader();
        text = await new Promise<string>((resolve) => {
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsText(input);
        });
      }

      const lines = text.split("\n").map((line) => line.trim()).filter(line => line !== "");

      const header = lines[0].split(",");
      const chunkSize = 5000;
      const totalLines = lines.length;
      let currentLine = 1;
      const allData: DataPoint[] = [];

      setDependentVariable(header[0]);

      const processChunk = () => {
        const chunk = lines.slice(currentLine, currentLine + chunkSize);
        currentLine += chunkSize;

        chunk.forEach((row) => {
          const values = row.split(",");
          const rowData: DataPoint = {};
          header.forEach((key, index) => {
            const value = values[index];
            rowData[key] = isNaN(parseFloat(value)) ? value : parseFloat(value);
          });
          allData.push(rowData);
        });

        setProgress(Math.min((currentLine / totalLines) * 100, 100));

        if (currentLine < totalLines) {
          setTimeout(processChunk, 0);
        } else {
          setData(allData);
          setLoading(false);

          const initialTimestamp = allData[0][header[0]] as number;
          setGlobalMin(0);
          const finalTimestamp = allData[allData.length - 1][header[0]] as number;
          setGlobalMax(finalTimestamp - initialTimestamp);
          setVisibleMax(finalTimestamp - initialTimestamp);
          setSecondsElapsed(finalTimestamp - initialTimestamp);
          setSampleRate(totalLines / (finalTimestamp - initialTimestamp));
        }
      };
      processChunk();
    } catch (error) {
      console.error("Error processing CSV:", error);
      setLoading(false);
    }
  };


  const toggleVariable = (variable: string) => {
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

  const renderGraph = () => {
    if (!data) return <p>No data to display</p>;

    if (!data[0].hasOwnProperty(dependentVariable)) {
      return (
        <div className="bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded-lg mt-4 max-w-xl mx-auto">
          <strong className="font-semibold text-xl">Error:</strong>
          <span className="block sm:inline text-lg"> No dependent variable field found in the data</span>
        </div>
      );
    }

    const initialTimestamp = (data[0][dependentVariable] as number);


    const adjustedMinimum = minimum + initialTimestamp;
    const adjustedMaximum = maximum + initialTimestamp;

    const filteredData = data
      .filter((point) => {
        const timestamp = point[dependentVariable] as number;
        return timestamp >= adjustedMinimum && timestamp <= adjustedMaximum;
      })
      .filter((point, index) => {
        let sizeValue = calculatedSizeValue(visibleRange, maxResolution, minResolution);
        sizeValue = Math.floor(sizeValue);
        return sizeValue > 0
          ? index % sizeValue === 0 || point["messages"] != null
          : true;
      });

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

    const datasets = Object.keys(filteredData[0])
      .filter((key) => key !== dependentVariable && key !== "messages" && selectedVariables.has(key))
      .map((key, index) => {
        const color = `hsl(${(index * 360) / Object.keys(filteredData[0]).length}, 100%, 50%)`;
        return {
          label: key,
          data: filteredData.map((point, idx) => ({
            x: (point[dependentVariable] as number) - initialTimestamp,
            y: point[key],
            message: messages[idx]
          })),
          borderColor: `hsl(${(index * 360) / selectedVariables.size}, 100%, 50%)`,
          borderWidth: 2,

          backgroundColor: color + "80",
          pointRadius: filteredData.map((point) => (point["messages"] ? 10 : 0)),
          pointHoverRadius: 8,
        };
      });

    const chartData = {
      labels,
      datasets,
    };

    const options = {
      responsive: true,
      animation: false as const,
      plugins: {
        legend: {
          position: "top" as const,
        },
        title: {
          display: true,
          text: "Data Chart",
        },
        zoom: {
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true,
            },
            mode: isZoomX && isZoomY ? "xy" : isZoomX ? "x" : isZoomY ? "y" : (undefined as "x" | "y" | "xy" | undefined),
            onZoom: ({ chart }: any) => handleChange(chart),
          },
          pan: {
            enabled: true,
            mode: "xy" as const,
            threshold: 5,
            onPan: ({ chart }: any) => handleChange(chart),
          },
        },
        tooltip: {
          mode: 'nearest' as const,
          intersect: false as const,
          callbacks: {
            label: function (tooltipItem: any) {
              const point = tooltipItem.raw;
              const message = point.message ? `Message: ${point.message}` : "";
              return `${tooltipItem.dataset.label}: ${tooltipItem.raw.y}${message ? `\n${message}` : ""}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Timestamp (s)",
          },
          type: "linear" as const,
          min: visibleMin,
          max: visibleMax,
          ticks: {
            callback: function (value: any, index: number): string {
              return messages[index] ? "⬤" : value;
            },
          },
        },
        y: {
          title: {
            display: true,
            text: "Value",
          },
          min: fixedMin,
          max: fixedMax,
        },
      },
    };

    return <Line data={chartData} options={options} />;
  };

  const renderVariableCheckboxes = () => {
    if (!data || data.length === 0) return null;

    const availableVariables = Object.keys(data[0]).filter((key) => key !== dependentVariable && key !== "messages");

    return (
      <div className="mt-4">
        <h2 className="text-xl font-semibold">Toggle Variables</h2>
        <div className="space-y-2">
          {availableVariables.map((variable) => (
            <div key={variable} className="flex items-center">
              <input
                type="checkbox"
                id={variable}
                checked={selectedVariables.has(variable)}
                onChange={() => toggleVariable(variable)}
                className="mr-2"
              />
              <label htmlFor={variable} className="text-lg">{variable}</label>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <>
      <div>
        <Navbar data={csvFiles} onSelect={handleFileUpload} />
      </div>
      <div className=" h-full w-full mx-auto p-6 flex flex-col md:flex-row">

        <div className="flex-1">
          <h1 className="text-3xl font-semibold text-center mb-8">CSV to Graph Converter</h1>

          <div className="flex flex-col space-y-4 mb-6">
            <input
              type="file"
              accept=".csv, .xlsx"
              className="w-full py-2 px-4 border border-gray-300 rounded-lg text-lg cursor-pointer"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }} />
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1">
              {renderVariableCheckboxes()}
            </div>
            <div className="w-full h-full">
              {loading && (
                <div className="mt-4">
                  <div className="w-full bg-gray-200 rounded-full">
                    <div
                      className="bg-blue-500 text-xs font-medium text-blue-100 text-center p-0.5 leading-none rounded-l-full"
                      style={{ width: `${progress}%` }}
                    >
                      {Math.round(progress)}% - Loading data...
                    </div>
                  </div>
                </div>
              )}
              <div className="text-center">
                <h1>Enlarged points contain messages</h1>
              </div>
              <p>Currently sampling one out of every {Math.floor(calculatedSizeValue(visibleRange, maxResolution, minResolution))} points</p>
              <div className="flex justify-center space-x-4">
                <div className="flex items-center space-x-2">
                  <h1>X Zoom</h1>
                  <input type="checkbox" className="toggle toggle-success" onClick={() => setIsZoomX(!isZoomX)} defaultChecked />
                </div>
                <div className="flex items-center space-x-2">
                  <h1>Y Zoom</h1>
                  <input type="checkbox" className="toggle toggle-success" onClick={() => setIsZoomY(!isZoomY)} defaultChecked />
                </div>
              </div>
              {renderGraph()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;