/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Atano-ish palette — clinical, calm, with a clear "live" accent.
        bg: "#0a0e14",
        panel: "#111720",
        panel2: "#161d28",
        border: "#1f2937",
        text: "#e5e7eb",
        muted: "#9ca3af",
        accent: "#10b981", // emerald — "live, captured"
        warn: "#f59e0b",
        danger: "#ef4444",
        agent: "#3b82f6",
        rep: "#a78bfa",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
