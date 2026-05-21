import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./lib/auth";
import { ColorSchemeProvider } from "./lib/color-scheme";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColorSchemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ColorSchemeProvider>
  </StrictMode>,
);
