import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#FAF9F6",
        ink: "#1A1A1A",
        "ink-2": "#3D3D3D",
        "ink-3": "#6E6E6E",
        "ink-4": "#A0A0A0",
        rule: "#E5E1DA",
        "rule-2": "#D6D1C7",
        accent: "#C04A3A",
        "accent-soft": "#F5DDD8",
        good: "#5A8C3F",
        warn: "#C28A2A",
        danger: "#B23A3A",
        // Annotation colors per type
        "ann-question": "#10B981",
        "ann-option":   "#3B82F6",
        "ann-answer":   "#F97316",
        "ann-solution": "#A855F7",
        "ann-figure":   "#EAB308",
        "ann-skip":     "#6B7280",
        "ann-unit":     "#EC4899",
      },
      fontFamily: {
        serif: ["Noto Serif TC", "ui-serif", "serif"],
        sans:  ["Inter", "ui-sans-serif", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
