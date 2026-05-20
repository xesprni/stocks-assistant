import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ColorSchemeProvider } from "./lib/color-scheme";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColorSchemeProvider>
      <App />
    </ColorSchemeProvider>
  </StrictMode>,
);
