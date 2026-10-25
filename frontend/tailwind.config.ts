import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        pane: "var(--pane)",
        "pane-raised": "var(--pane-raised)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        text: "var(--text)",
        "text-dim": "var(--text-dim)",
        "text-faint": "var(--text-faint)",
        intercept: "var(--red)",
        safe: "var(--green)",
        live: "var(--cyan)",
        warn: "var(--amber)",
        "live-dim": "var(--cyan-dim)",
        "intercept-dim": "var(--red-dim)",
        "safe-dim": "var(--green-dim)",
        "warn-dim": "var(--amber-dim)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
