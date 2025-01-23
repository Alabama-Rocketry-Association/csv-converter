/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html", // Include index.html
    "./src/**/*.{js,ts,jsx,tsx}" // Include all source files
  ],
  theme: {
    extend: {}, // Extend Tailwind's default theme if needed
  },
  plugins: [], // Add Tailwind plugins here if needed
};
