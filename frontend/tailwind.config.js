/** @type {import('tailwindcss').Config} */

// Every colour resolves through a CSS variable defined in src/index.css, so flipping the
// `dark` class on <html> re-themes the whole app without changing a single component class.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

// Full 50–900 for every ramp: overriding a colour replaces its whole scale, so a missing
// step would silently drop classes like `text-emerald-800` and lose their colour.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const ramp = (prefix, steps = STEPS) =>
  Object.fromEntries(steps.map((s) => [s, token(`${prefix}-${s}`)]));

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        white: token("c-white"),
        slate: ramp("slate"),
        amber: ramp("amber"),
        emerald: ramp("emerald"),
        rose: ramp("rose"),
        sky: ramp("sky"),
        blue: ramp("blue"),
        orange: ramp("orange"),
        indigo: ramp("indigo"),
      },
    },
  },
  plugins: [],
};
