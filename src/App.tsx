import { useState, useEffect} from "react";
import { Line } from "react-chartjs-2";
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
import zoomPlugin from "chartjs-plugin-zoom";
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
const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN;

const fetchCSVFiles = async () => {
  const repoUrl =
    "https://api.github.com/repos/Alabama-Rocketry-Association/csv-converter/contents/TestData";

  try {
    const response = await fetch(repoUrl, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
      },
    });

    if (!response.ok) throw new Error("Failed to fetch CSV list");

    const data = await response.json();
    return data
      .filter((file: any) => file.name.endsWith(".csv"))
      .map((file: any) => ({
        name: file.name,
        url: file.download_url,
      }));
  } catch (error) {
    
    console.error("Error fetching CSV files:", error);
    return (
      <div>
        <strong className="font-semibold text-xl">Error:</strong>
        <span className="block sm:inline text-lg"> Failed to load CSV file</span>
      </div>
    );
  }
};

function App() {
  const [data, setData] = useState<DataPoint[] | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedVariables, setSelectedVariables] = useState<Set<string>>(new Set());
  const [minimum, setMinimum] = useState<number>(0);
  const [maximum, setMaximum] = useState<number>(Infinity);
  const [csvFiles, setCsvFiles] = useState<{ name: string; url: string }[]>([]);

  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);

  const [visibleMin, setVisibleMin] = useState<number>(0);
  const [visibleMax, setVisibleMax] = useState<number>(0);
  const [visibleRange, setVisibleRange] = useState<number>(1);
  
  const maxResolution = 1;
  const minResolution = 100;

  useEffect(() => {
    fetchCSVFiles().then((files) => {
      setCsvFiles(files);
      setLoading(false);
    });
  }, []);


  const handleChange = (chart: any) => {
    const xScale = chart.scales["x"];

    const newVisibleMin = xScale.min;
    const newVisibleMax = xScale.max;
    const newVisibleRange = xScale.max - xScale.min;
  
    setVisibleMin(newVisibleMin);
    setVisibleMax(newVisibleMax);
    setVisibleRange(newVisibleRange);
    setMinimum(newVisibleMin);
    setMaximum(newVisibleMax);

    console.log("New Calculated Size Value:", calculatedSizeValue(newVisibleRange, maxResolution, minResolution));
  };

  const calculatedSizeValue = (visibleRange: number, maxResolution: number, minResolution: number) => {
    const rangeRatio = visibleRange / (secondsElapsed * maxResolution);
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
  
          const initialTimestamp = allData[0]["timestamp"] as number;
          const finalTimestamp = allData[allData.length - 1]["timestamp"] as number;
          setVisibleMax(finalTimestamp - initialTimestamp);
          setSecondsElapsed(finalTimestamp - initialTimestamp);
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
  
    if (!data[0].hasOwnProperty("timestamp")) {
      return (
        <div className="bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded-lg mt-4 max-w-xl mx-auto">
          <strong className="font-semibold text-xl">Error:</strong>
          <span className="block sm:inline text-lg"> No "timestamp" field found in the data</span>
        </div>
      );
    }
  
    const initialTimestamp = (data[0]["timestamp"] as number);

  
    const adjustedMinimum = minimum + initialTimestamp;
    const adjustedMaximum = maximum + initialTimestamp;

    const filteredData = data
    .filter((point) => {
      const timestamp = point["timestamp"] as number;
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
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-6 py-4 rounded-lg   mt-4 max-w-xl mx-auto">
          <strong className="font-semibold text-xl">Warning:</strong>
          <span className="block sm:inline text-lg"> No data available in the given timestamp range.</span>
        </div>
      );
    }
  
    const labels = filteredData.map((point) => (point["timestamp"] as number) - initialTimestamp);
    const messages = filteredData.map((point) => (point["messages"] ? point["messages"] : null));
  
    const datasets = Object.keys(filteredData[0])
      .filter((key) => key !== "timestamp" && key !== "messages" && selectedVariables.has(key)) // Filter based on toggled variables
      .map((key, index) => {
        const color = `hsl(${(index * 360) / Object.keys(filteredData[0]).length}, 100%, 50%)`;
        return {
          label: key,
          data: filteredData.map((point, idx) => ({
            x: (point["timestamp"] as number) - initialTimestamp,
            y: point[key],         
            message: messages[idx]
          })),
          borderColor: `hsl(${(index * 360) / selectedVariables.size}, 100%, 50%)`,
          borderWidth: 2, // Thin lines for performance
  
          backgroundColor: color + "80",
          pointRadius: filteredData.map((point) => (point["messages"] ? 10 : 0)), // Only show points with messages
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
          text:"Data Chart",
        },
        zoom: {
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true,
            },
            mode: "xy" as const,
            onZoom: ({ chart }: any) => handleChange(chart),
          },
          pan: {
            enabled: true,
            mode: "x" as const,
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
        },
      },
    };
    
    return <Line data={chartData} options={options} />;
  };
  
  
  
  

  const renderVariableCheckboxes = () => {
    if (!data || data.length === 0) return null;

    const availableVariables = Object.keys(data[0]).filter((key) => key !== "timestamp" && key !== "messages");

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
      <Navbar data= {csvFiles} onSelect = {handleFileUpload}/>
    </div>
    <div className=" h-full w-full mx-auto p-6 flex flex-col md:flex-row">

      <div className="flex-1">
        <h1 className="text-3xl font-semibold text-center mb-8">CSV to Graph Converter</h1>

        <div className="flex flex-col space-y-4 mb-6">
          <input 
          type="file" 
          accept=".csv"
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
            {renderGraph()}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

export default App;