import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { QuotaProvider } from "./components/Quota";
import { SessionProvider } from "./components/Session";
import { ToastProvider } from "./components/Toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthGate>
          <SessionProvider>
            <QuotaProvider>
              <App />
            </QuotaProvider>
          </SessionProvider>
        </AuthGate>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
