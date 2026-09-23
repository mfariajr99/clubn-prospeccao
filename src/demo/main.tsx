import "../styles/app.css";
import { RotateCcw } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "../App";
import { QuotaProvider } from "../components/Quota";
import { SessionProvider } from "../components/Session";
import { ToastProvider } from "../components/Toast";
import { resetDemoData, startDemoServer } from "./demoServer";

function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <span>
        <strong>Versão de demonstração.</strong> Dados fictícios, salvos só neste navegador. “Enviar mensagem” abre o WhatsApp de verdade: use um número seu para testar.
      </span>
      <button type="button" className="btn xs secondary" onClick={resetDemoData}>
        <RotateCcw size={13} /> Restaurar dados
      </button>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<div className="demo-loading">Carregando demonstração…</div>);

startDemoServer()
  .then(() =>
    root.render(
      <StrictMode>
        <HashRouter>
          <ToastProvider>
            <SessionProvider>
              <QuotaProvider>
                <DemoBanner />
                <App />
              </QuotaProvider>
            </SessionProvider>
          </ToastProvider>
        </HashRouter>
      </StrictMode>,
    ),
  )
  .catch((error) => {
    console.error(error);
    root.render(<div className="demo-loading">Não foi possível iniciar a demonstração neste navegador.</div>);
  });
