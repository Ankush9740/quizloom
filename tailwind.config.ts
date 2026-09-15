import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14213D",
        paper: "#FFFDF7",
        blue: "#3155E7",
        coral: "#FF6846",
        mint: "#20B486",
        sun: "#F6C453"
      },
      boxShadow: { card: "0 12px 35px rgba(20,33,61,.10)" },
      keyframes: {
        pop: { "0%": { opacity: "0", transform: "translateY(8px) scale(.97)" }, "100%": { opacity: "1", transform: "none" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-7px)" } }
      },
      animation: { pop: "pop .35s ease-out both", float: "float 4s ease-in-out infinite" }
    }
  },
  plugins: []
};
export default config;
