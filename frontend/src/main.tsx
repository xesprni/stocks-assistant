import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ToastProvider } from "./components/common/Toast";
import { AuthProvider } from "./lib/auth";
import { ColorSchemeProvider } from "./lib/color-scheme";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ColorSchemeProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ColorSchemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
