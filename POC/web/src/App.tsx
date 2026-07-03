import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import AdInsightPage from "./pages/AdInsightPage";
import OpsDeskPage from "./pages/OpsDeskPage";
import { applyTheme, getStoredTheme, type Theme } from "./lib/theme";

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <BrowserRouter>
      <div className="flex h-screen flex-col">
        <Routes>
          <Route path="/" element={<AdInsightPage theme={theme} onToggleTheme={toggleTheme} />} />
          <Route path="/ops" element={<OpsDeskPage theme={theme} onToggleTheme={toggleTheme} />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
