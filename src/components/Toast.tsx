import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastKind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (message: string, kind?: ToastKind, action?: ToastItem["action"]) => void;
  success: (message: string, action?: ToastItem["action"]) => void;
  error: (message: string, action?: ToastItem["action"]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, kind: ToastKind = "info", action?: ToastItem["action"]) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, kind, message, action }]);
      window.setTimeout(() => dismiss(id), action ? 9000 : 5000);
    },
    [dismiss],
  );
  const value = useMemo<ToastApi>(
    () => ({ show, success: (m, a) => show(m, "success", a), error: (m, a) => show(m, "error", a) }),
    [show],
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "success" ? <CheckCircle2 size={18} /> : t.kind === "error" ? <TriangleAlert size={18} /> : <Info size={18} />}
            <div className="t-body">
              <div>{t.message}</div>
              {t.action && (
                <button
                  className="t-action"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button className="t-close" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
