import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "@/components/common/Toast";
import { WatchlistPage } from "@/pages/WatchlistPage";
import { ColorSchemeProvider } from "@/lib/color-scheme";
function Fixture() {
  const [symbol, setSymbol] = useState("");
  return <main className="console-shell-watchlist" style={{ height: "100dvh", padding: 12, display: "flex" }}>
    <WatchlistPage language="zh" selectedSymbol={symbol} onSelectedSymbolChange={setSymbol} onOpenFinancials={() => {}} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><ColorSchemeProvider><ToastProvider><Fixture /></ToastProvider></ColorSchemeProvider></StrictMode>);
