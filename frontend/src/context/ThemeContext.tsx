import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type ThemePref = "light" | "dark" | "system";

type ThemeApi = {
  pref: ThemePref;
  /** What is actually on screen once "system" is resolved. */
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
};

const KEY = "st_theme";
const ThemeContext = createContext<ThemeApi | null>(null);

const systemDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(
    () => (localStorage.getItem(KEY) as ThemePref | null) ?? "system",
  );
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    ((localStorage.getItem(KEY) as ThemePref | null) ?? "system") === "system"
      ? (systemDark() ? "dark" : "light")
      : ((localStorage.getItem(KEY) as "light" | "dark") ?? "light"),
  );

  // Apply to <html> — Tailwind's darkMode:"class" keys off this.
  useEffect(() => {
    const apply = () => {
      const next = pref === "system" ? (systemDark() ? "dark" : "light") : pref;
      setResolved(next);
      document.documentElement.classList.toggle("dark", next === "dark");
    };
    apply();

    // Follow the OS while the preference is "system".
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    localStorage.setItem(KEY, p);
  };

  return (
    <ThemeContext.Provider value={{ pref, resolved, setPref }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
