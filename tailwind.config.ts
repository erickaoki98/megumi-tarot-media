import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#161126",
        haze: "#f6f3ff",
        mist: "#ece6ff",
        violet: "#7c3aed",
        plum: "#5b21b6",
        lilac: "#c4b5fd",
        panel: "rgba(255, 255, 255, 0.82)",
      },
      fontFamily: {
        display: ["Avenir Next", "Trebuchet MS", "sans-serif"],
        body: ["Avenir", "Avenir Next", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        panel: "0 20px 60px rgba(76, 29, 149, 0.12)",
      },
      backgroundImage: {
        "hero-wash":
          "radial-gradient(circle at top left, rgba(124, 58, 237, 0.18), transparent 24%), radial-gradient(circle at 85% 20%, rgba(167, 139, 250, 0.18), transparent 28%), linear-gradient(180deg, #fcfbff 0%, #f3efff 48%, #f7f4ff 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
