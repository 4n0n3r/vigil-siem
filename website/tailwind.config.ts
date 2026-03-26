import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "bg-primary": "#080B10",
        "bg-card": "#0E1117",
        "bg-elevated": "#161B22",
        "border-subtle": "#1E2633",
        "text-primary": "#E2E8F0",
        "text-muted": "#718096",
        "accent-cyan": "#00E5FF",
        "accent-amber": "#FFB547",
        "accent-red": "#F85149",
        "accent-green": "#3FB950",
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "cursor-blink": "cursor-blink 1s step-end infinite",
        "pulse-glow-red": "pulse-glow-red 2s ease-in-out infinite",
        "pulse-glow-cyan": "pulse-glow-cyan 3s ease-in-out infinite",
        "fade-up": "fade-up 0.5s ease-out forwards",
        "fade-in": "fade-in 0.4s ease-out forwards",
      },
      keyframes: {
        "cursor-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "pulse-glow-red": {
          "0%, 100%": { boxShadow: "0 0 4px #F85149" },
          "50%": { boxShadow: "0 0 14px #F85149, 0 0 28px rgba(248,81,73,0.3)" },
        },
        "pulse-glow-cyan": {
          "0%, 100%": { boxShadow: "0 0 8px rgba(0,229,255,0.25)" },
          "50%": { boxShadow: "0 0 20px rgba(0,229,255,0.4), 0 0 40px rgba(0,229,255,0.1)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
