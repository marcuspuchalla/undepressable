/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Undepressable brand — a calm, resilient dark identity.
        ink: "#0b0d10", // deepest background
        night: "#0e1116", // panels / bars
        haze: "#10151f", // raised surfaces
        line: "#1e2735", // hairline borders
        glow: "#7dd3fc", // cyan — primary accent / "signal"
        moss: "#6ee7b7", // green — safe / verified
        ember: "#fb7185", // rose — recording / alert
        // `primary` mapped to the sky/glow scale so existing primary-* classes
        // inherit the brand accent automatically.
        primary: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
          950: "#082f49",
        },
        // Recording / alert stays red — semantically correct.
        emergency: {
          400: "#fb7185",
          500: "#f43f5e",
          600: "#e11d48",
          700: "#be123c",
        },
      },
      fontFamily: {
        // Privacy-first: no CDN fonts (offline + no IP leak). A serif display
        // stack carries the brand's editorial character; system sans for body.
        // Drop self-hosted Fraunces/Archivo woff2 here later if desired.
        display: ['"Fraunces"', "ui-serif", "Georgia", "Cambria", "serif"],
        body: ['"Archivo"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        soft: "0 20px 60px -20px rgba(0,0,0,0.6)",
        halo: "0 0 0 1px rgba(125,211,252,0.15), 0 12px 40px -12px rgba(125,211,252,0.25)",
      },
      backgroundImage: {
        "radial-fade":
          "radial-gradient(60% 60% at 20% 10%, rgba(110,231,183,0.10), transparent), radial-gradient(50% 50% at 85% 15%, rgba(125,211,252,0.12), transparent), radial-gradient(60% 60% at 60% 90%, rgba(251,113,133,0.08), transparent)",
      },
      animation: {
        "pulse-fast": "pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        recording: "recording 2s ease-in-out infinite",
      },
      keyframes: {
        recording: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [],
};
