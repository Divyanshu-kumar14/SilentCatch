import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: token("paper"),
        "paper-deep": token("paper-deep"),
        sheet: token("sheet"),
        "sheet-2": token("sheet-2"),
        ink: token("ink"),
        "ink-2": token("ink-2"),
        muted: token("muted"),
        faint: token("faint"),
        edge: token("edge"),
        "edge-2": token("edge-2"),
        signal: token("signal"),
        "signal-ink": token("signal-ink"),
        "signal-wash": token("signal-wash"),
        safe: token("safe"),
        "safe-wash": token("safe-wash"),
        warn: token("warn"),
        "warn-wash": token("warn-wash"),
        night: token("night"),
        "night-2": token("night-2"),
        "night-ink": token("night-ink"),
        "night-muted": token("night-muted"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Iowan Old Style", "Georgia", "serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sheet: "16px",
      },
    },
  },
  plugins: [],
};
export default config;
