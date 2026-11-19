/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Undepressable: a risograph print at night. Two inks — fluorescent
        // pink and aqua — on deep indigo paper, the way protest posters and
        // zines are printed: every copy a little off register, all of them
        // saying the same thing.
        ink: "#121530", // paper — deepest background
        night: "#171b3b", // bars and panels
        haze: "#1e2348", // raised surfaces
        line: "#2e3466", // rules and borders
        print: "#f4f2ff", // the white "ink" — primary text
        glow: "#4fe0d9", // aqua ink — signal, links, the second copy
        moss: "#b5e65a", // riso lime — safe, verified, kept
        ember: "#ff4fa0", // fluorescent pink — live, recording, act now
        // primary-* follows the aqua ink, so existing classes pick it up.
        primary: {
          50: "#ecfefc",
          100: "#cffcf7",
          200: "#a2f7f0",
          300: "#6eeee5",
          400: "#4fe0d9",
          500: "#1fc4bf",
          600: "#0f9e9d",
          700: "#107d7e",
          800: "#126364",
          900: "#134f52",
          950: "#052f32",
        },
        // Recording / alert: the pink ink.
        emergency: {
          400: "#ff7ab8",
          500: "#ff4fa0",
          600: "#e8338a",
          700: "#c21f70",
        },
      },
      fontFamily: {
        // Self-hosted (src/assets/fonts.css): no CDN, works offline.
        display: ['"Bricolage"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        body: ['"Bricolage"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        soft: "0 18px 50px -24px rgba(6, 8, 26, 0.85)",
        halo: "0 0 0 1px rgba(79,224,217,0.18), 0 12px 40px -14px rgba(79,224,217,0.3)",
        // A print lifted off the stack: hard, slightly offset, no blur.
        print: "6px 6px 0 0 rgba(6, 8, 26, 0.55)",
      },
      backgroundImage: {
        "radial-fade":
          "radial-gradient(60% 60% at 20% 10%, rgba(181,230,90,0.07), transparent), radial-gradient(50% 50% at 85% 15%, rgba(79,224,217,0.10), transparent), radial-gradient(60% 60% at 60% 90%, rgba(255,79,160,0.08), transparent)",
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
