import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#191812",
        sand: "#efe3d1",
        cream: "#f8f3eb",
        ember: "#f36a3d",
        lagoon: "#0f766e",
        panel: "rgba(255, 250, 242, 0.8)",
      },
      fontFamily: {
        display: ["Avenir Next", "Trebuchet MS", "sans-serif"],
        body: ["Avenir", "Avenir Next", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        panel: "0 20px 60px rgba(104, 75, 24, 0.12)",
      },
      backgroundImage: {
        "hero-wash":
          "radial-gradient(circle at top left, rgba(243, 106, 61, 0.22), transparent 28%), radial-gradient(circle at 85% 20%, rgba(15, 118, 110, 0.18), transparent 25%), linear-gradient(135deg, #f8f3e9 0%, #efe5d1 50%, #f5ecdf 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
