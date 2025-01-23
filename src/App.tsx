import { useState } from "react";
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
//Eventually enable this for image export
// import ChartJsImage from 'chartjs-to-image';

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

function App() {
  const [data, setData] = useState<DataPoint[] | null>(null);
  // const [title, setTitle] = useState<string>("");
  const [size, setSize] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedVariables, setSelectedVariables] = useState<Set<string>>(new Set());
  const [minimum, setMinimum] = useState<number>(0);
  const [maximum, setMaximum] = useState<number>(Infinity);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLoading(true);
      const reader = new FileReader();

      reader.onload = (event) => {
        const text = event.target?.result as string;
        const lines = text.split("\n").map((line) => line.trim()).filter(line => line !== "");

        const header = lines[0].split(",");
        const chunkSize = 5000;
        const totalLines = lines.length;
        let currentLine = 1;
        const allData: DataPoint[] = [];

        const processChunk = () => {
          const chunk = lines.slice(currentLine, currentLine + chunkSize);
          currentLine += chunkSize;
        
            chunk.forEach((row, index) => {
            const values = row.split(",");
            const rowData: DataPoint = {};
            header.forEach((key, index) => {
              const value = values[index];
              rowData[key] = isNaN(parseFloat(value)) ? value : parseFloat(value);
            });
            if (index % (size ? parseInt(size) : 1) === 0 || rowData["messages"] != null) {
              allData.push(rowData);
            }
            });
        
          setProgress(Math.min((currentLine / totalLines) * 100, 100));
        
          if (currentLine < totalLines) {
            setTimeout(processChunk, 0);
          } else {
            setData(allData);
            setLoading(false);
          }
        };
        

        processChunk();
      };

      reader.readAsText(file);
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
  
    // Extract the initialTimestamp before filtering
    const initialTimestamp = (data[0]["timestamp"] as number);
  
    // Adjust the minimum and maximum values by adding the initialTimestamp
    const adjustedMinimum = minimum + initialTimestamp;
    const adjustedMaximum = maximum + initialTimestamp;
  
    // Filter data based on adjusted minimum and maximum timestamp
    const filteredData = data.filter((point) => {
      const timestamp = point["timestamp"] as number;
      return timestamp >= adjustedMinimum && timestamp <= adjustedMaximum;
    });
  
    // Check if filteredData is empty
    if (filteredData.length === 0) {
      return (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-6 py-4 rounded-lg   mt-4 max-w-xl mx-auto">
          <strong className="font-semibold text-xl">Warning:</strong>
          <span className="block sm:inline text-lg"> No data available in the given timestamp range.</span>
        </div>
      );
    }
  
    // Extract labels and messages from the filtered data
    const labels = filteredData.map((point) => (point["timestamp"] as number) - initialTimestamp); // Adjusted timestamp for labels
    const messages = filteredData.map((point) => (point["messages"] ? point["messages"] : null));
  
    const datasets = Object.keys(filteredData[0])
      .filter((key) => key !== "timestamp" && key !== "messages" && selectedVariables.has(key)) // Filter based on toggled variables
      .map((key, index) => {
        const color = `hsl(${(index * 360) / Object.keys(filteredData[0]).length}, 100%, 50%)`;
        return {
          label: key,
          data: filteredData.map((point, idx) => ({
            x: (point["timestamp"] as number) - initialTimestamp, // Use adjusted timestamp as x-coordinate
            y: point[key],         // Use the variable value as y-coordinate
            message: messages[idx] // Attach the message for tooltip callback
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
            mode: "x" as const,
          },
          pan: {
            enabled: true,
            mode: "x" as const,
          },
        },
        tooltip: {
          mode: 'nearest' as const, // Ensures tooltip shows for nearest point, even if you're not directly on the line
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
          type: "linear" as const, // Ensures the x-axis scales correctly for continuous numeric values
          ticks: {
            callback: function (value: any, index: number): string {
              // Add tick mark for timestamps with messages
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
    <div className="App max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-semibold text-center mb-8">CSV to Graph Converter</h1>

      {/* Top section for inputs */}
      <div className="flex flex-col space-y-4 mb-6">
        {/* <input
          type="text"
          placeholder="Enter a title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full py-2 px-4 border border-gray-300 rounded-lg text-lg"
        /> */}
        <input
          type="text"
          placeholder="Reduce Dataset Size (Sample every nth point)"
          onChange={(e) => setSize((e.target as HTMLInputElement).value)}
          className="w-full py-2 px-4 border border-gray-300 rounded-lg text-lg"
        />
        <div className="flex items-center space-x-4">
          <h1>From timestamp</h1>
          <input
        type="number"
        placeholder="Minimum Value"
        onSubmit={(e) => setMinimum(parseInt((e.target as HTMLInputElement).value))} 
        className="py-2 px-4 border border-gray-300 rounded-lg text-lg"
          />
          <h1>to</h1>
          <input
        type="number"
        placeholder="Maximum Value"
        onSubmit={(e) => setMaximum(parseInt((e.target as HTMLInputElement).value))} 
        className="py-2 px-4 border border-gray-300 rounded-lg text-lg"
          />
            <button
            onClick={() => {
              const minInput = document.querySelector<HTMLInputElement>('input[placeholder="Minimum Value"]');
              const maxInput = document.querySelector<HTMLInputElement>('input[placeholder="Maximum Value"]');
              if (minInput) setMinimum(parseInt(minInput.value));
              if (maxInput) setMaximum(parseInt(maxInput.value));
            }}
            className="py-2 px-4 bg-blue-500 text-white rounded-lg text-lg"
            >
            Submit
            </button>
        </div>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="w-full py-2 px-4 border border-gray-300 rounded-lg text-lg cursor-pointer"
        />
      </div>

      {/* Section below for toggle variables and graph */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* Left side: Toggle Variables */}
        <div className="flex-1">
          {renderVariableCheckboxes()}
        </div>

        {/* Right side: Graph */}
        <div className="w-full h-full"> {/* Full width and a custom height */}
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
              <p>Enlarged points contain messages</p>
              </div>
          {renderGraph()}
        </div>
      </div>
    </div>
  );
}

export default App;
