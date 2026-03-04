import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";

const THEME_STORAGE_KEY = "theme";

const getPreferredTheme = () => {
  if (typeof window === "undefined") return "light";

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
};

export const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const preferred = getPreferredTheme();
    const root = document.documentElement;

    if (preferred === "dark") {
      root.classList.add("dark");
      setIsDark(true);
    } else {
      root.classList.remove("dark");
      setIsDark(false);
    }
  }, []);

  const handleChange = (checked: boolean) => {
    const root = document.documentElement;

    if (checked) {
      root.classList.add("dark");
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    } else {
      root.classList.remove("dark");
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    }

    setIsDark(checked);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {isDark ? "Dark mode" : "Light mode"}
      </span>
      <Switch checked={isDark} onCheckedChange={handleChange} />
    </div>
  );
}

