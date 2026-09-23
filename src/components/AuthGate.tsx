import { LockKeyhole } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage } from "../lib/api";

type State = "checking" | "open" | "login";

/** Shows the team login screen when the server requires a password. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");

  const check = useCallback(() => {
    api
      .get<{ required: boolean; authenticated: boolean }>("/auth/status")
      .then((s) => setState(!s.required || s.authenticated ? "open" : "login"))
      .catch(() => setState("open")); // demo build / older server: no login route
  }, []);

  useEffect(() => {
    check();
    const onRequired = () => setState("login");
    window.addEventListener("clubn:auth-required", onRequired);
    return () => window.removeEventListener("clubn:auth-required", onRequired);
  }, [check]);

  if (state === "checking") return <div className="demo-loading">Carregando…</div>;
  if (state === "login") return <LoginScreen onSuccess={() => setState("open")} />;
  return <>{children}</>;
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { password });
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={submit} noValidate>
        <img src="/logo-clubn.png" alt="Club’n" width={128} height={36} />
        <div>
          <h1>Acesso da equipe</h1>
          <p className="muted">Digite a senha de acesso para entrar no sistema de prospecção.</p>
        </div>
        <div className={`field ${error ? "invalid" : ""}`}>
          <label htmlFor="login-password">Senha</label>
          <input id="login-password" className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </div>
        <button className="btn block" type="submit" disabled={busy || !password}>
          <LockKeyhole size={16} /> {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

export async function logout() {
  try {
    await api.post("/auth/logout");
  } finally {
    window.location.reload();
  }
}
