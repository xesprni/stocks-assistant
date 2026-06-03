import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthProvider } from "./lib/auth";
import { ColorSchemeProvider } from "./lib/color-scheme";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ColorSchemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ColorSchemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
