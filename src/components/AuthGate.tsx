import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AuthStatus } from "../../shared/types";
import { api, errorMessage } from "../lib/api";

const OPEN_ADMIN: AuthStatus = { required: false, authenticated: true, role: "admin", account: null };
const AuthContext = createContext<AuthStatus>(OPEN_ADMIN);

/** Who is logged in: the master admin or a client account. */
export const useAuth = () => useContext(AuthContext);
export const AuthContextForTests = AuthContext.Provider;

type State = { kind: "checking" } | { kind: "login"; hint?: string } | { kind: "open"; status: AuthStatus };

/** Shows the login screen when the server requires it, then provides the identity. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  const check = useCallback(() => {
    api
      .get<AuthStatus>("/auth/status")
      .then((s) => setState(s.authenticated ? { kind: "open", status: { ...OPEN_ADMIN, ...s } } : { kind: "login", hint: s.hint }))
      .catch(() => setState({ kind: "open", status: OPEN_ADMIN })); // older server: no login route
  }, []);

  useEffect(() => {
    check();
    const onRequired = () => setState((s) => ({ kind: "login", hint: s.kind === "login" ? s.hint : undefined }));
    window.addEventListener("clubn:auth-required", onRequired);
    return () => window.removeEventListener("clubn:auth-required", onRequired);
  }, [check]);

  if (state.kind === "checking") return <div className="demo-loading">Carregando…</div>;
  if (state.kind === "login") return <LoginScreen hint={state.hint} onSuccess={check} />;
  return <AuthContext.Provider value={state.status}>{children}</AuthContext.Provider>;
}

function LoginScreen({ onSuccess, hint }: { onSuccess: () => void; hint?: string }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { login: login.trim(), password });
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
          <h1>Entrar</h1>
          <p className="muted">Use o login e a senha que você recebeu para acessar o sistema de prospecção.</p>
        </div>
        {hint && (
          <div className="notice" role="note">
            {hint}
          </div>
        )}
        <div className="field">
          <label htmlFor="login-user">Login</label>
          <input
            id="login-user"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </div>
        <div className={`field ${error ? "invalid" : ""}`}>
          <label htmlFor="login-password">Senha</label>
          <div className="input-with-action">
            <input id="login-password" className="input" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="icon-btn plain" aria-label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </div>
        <button className="btn block" type="submit" disabled={busy || !password || !login.trim()}>
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
