import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#090A0F",
      },
      fontFamily: {
        sans: ['"Inter"', "-apple-system", "BlinkMacSystemFont", '"SF Pro Text"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", '"SF Mono"', "Menlo", "monospace"],
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        pulseRing: { "0%": { transform: "scale(1)", opacity: ".55" }, "100%": { transform: "scale(2.6)", opacity: "0" } },
        slideIn: { from: { opacity: "0", transform: "translateX(16px)" }, to: { opacity: "1", transform: "none" } },
        glow: { "0%,100%": { opacity: ".65", transform: "scale(1)" }, "50%": { opacity: "1", transform: "scale(1.06)" } },
        radar: { "0%": { transform: "scale(.5)", opacity: ".55" }, "100%": { transform: "scale(1.35)", opacity: "0" } },
        gaugeRadar: { "0%": { transform: "scale(.52)", opacity: ".5" }, "100%": { transform: "scale(1)", opacity: "0" } },
        flowX: { to: { backgroundPosition: "-200% 0" } },
        flowY: { to: { backgroundPosition: "0 -200%" } },
        spinSlow: { to: { transform: "rotate(360deg)" } },
      },
      animation: {
        rise: "rise .5s cubic-bezier(.2,.8,.2,1) both",
        pulseRing: "pulseRing 1.9s cubic-bezier(.2,.6,.3,1) infinite",
        slideIn: "slideIn .35s cubic-bezier(.2,.8,.2,1) both",
        glow: "glow 3.2s ease-in-out infinite",
        radar: "radar 3.6s cubic-bezier(.2,.6,.3,1) infinite",
        gaugeRadar: "gaugeRadar 3.6s cubic-bezier(.2,.6,.3,1) infinite",
        flowX: "flowX 2.4s linear infinite",
        flowY: "flowY 2.4s linear infinite",
        spinSlow: "spinSlow 24s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
