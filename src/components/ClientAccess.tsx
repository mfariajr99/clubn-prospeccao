import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useToast } from "./Toast";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Easy-to-type random password (no ambiguous characters such as 0/O, 1/l). */
export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function PasswordInput({ id, value, onChange, invalid }: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [show, setShow] = useState(true);
  return (
    <div className="input-with-action">
      <input
        id={id}
        className="input mono"
        type={show ? "text" : "password"}
        autoComplete="new-password"
        spellCheck={false}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        maxLength={200}
      />
      <button type="button" className="icon-btn plain" aria-label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow((v) => !v)}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
      <button type="button" className="btn secondary sm" onClick={() => onChange(generatePassword())}>
        <RefreshCw size={14} /> Gerar
      </button>
    </div>
  );
}

/** Access data to hand over to the client (the password is only shown now). */
export function CredentialsBox({ name, login, password }: { name: string; login: string; password: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const address = window.location.origin.startsWith("http") && !window.location.origin.includes("claude") ? window.location.origin : "";
  const text = [`Acesso ao Club’n Prospecção — ${name}`, address && `Endereço: ${address}`, `Login: ${login}`, `Senha: ${password}`].filter(Boolean).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Dados de acesso copiados.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };
  return (
    <div className="credentials-box" data-testid="client-credentials">
      <pre className="mono">{text}</pre>
      <button type="button" className="btn sm" onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiado" : "Copiar dados de acesso"}
      </button>
      <p className="small muted" style={{ margin: 0 }}>
        Guarde ou envie agora: por segurança a senha não fica visível depois. Se perder, use “Redefinir senha”.
      </p>
    </div>
  );
}
