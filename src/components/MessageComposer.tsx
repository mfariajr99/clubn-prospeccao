import { TriangleAlert } from "lucide-react";
import { Fragment, useMemo, useRef } from "react";
import { SAMPLE_TEMPLATE_LEAD, TEMPLATE_VARIABLES, renderTemplate, type TemplateLead } from "../../shared/template";
import { buildWhatsAppUrl } from "../../shared/template";
import { Field } from "./ui";

interface Props {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  previewLeads?: (TemplateLead & { id: number; whatsapp?: string })[];
  previewLeadId: number | null;
  onPreviewLeadChange: (id: number | null) => void;
}

/** Highlights unknown variables left in the rendered text. */
function highlight(text: string) {
  const parts = text.split(/(\{\{[^{}]*\}\})/g);
  return parts.map((p, i) => (/^\{\{[^{}]*\}\}$/.test(p) ? <span key={i} className="unknown">{p}</span> : <Fragment key={i}>{p}</Fragment>));
}

export function MessageComposer({ id = "campaign-message", label = "Mensagem padrão do WhatsApp", value, onChange, error, previewLeads = [], previewLeadId, onPreviewLeadChange }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lead = previewLeads.find((l) => l.id === previewLeadId) ?? null;
  const rendered = useMemo(() => renderTemplate(value, lead ?? SAMPLE_TEMPLATE_LEAD), [value, lead]);
  const waUrl = lead?.whatsapp ? buildWhatsAppUrl(lead.whatsapp, rendered.text) : null;

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const el = ref.current;
    if (!el) return onChange(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="grid-halves">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label={label} required error={error} htmlFor={id} hint={`${value.length}/3000 caracteres`}>
          <textarea id={id} ref={ref} className="textarea" style={{ minHeight: 190 }} maxLength={3000} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Olá, {{nome_estabelecimento}}! ..." />
        </Field>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Inserir variável:
          </div>
          <div className="var-chips">
            {TEMPLATE_VARIABLES.map((v) => (
              <button type="button" key={v.key} className="var-chip" onClick={() => insert(v.key)} title={v.label}>
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
        </div>
        {rendered.unknown.length > 0 && (
          <div className="notice danger" role="alert">
            <TriangleAlert size={16} />
            <span>
              Variáveis desconhecidas não serão substituídas: {rendered.unknown.map((u) => `{{${u}}}`).join(", ")}. Use apenas as variáveis listadas.
            </span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="label" style={{ fontWeight: 600, fontSize: 13, color: "var(--text-2)" }}>
            Prévia da mensagem
          </span>
          <select className="select" style={{ height: 36, width: "auto", maxWidth: 260 }} aria-label="Lead usado na prévia" value={previewLeadId ?? ""} onChange={(e) => onPreviewLeadChange(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Dados fictícios</option>
            {previewLeads.slice(0, 50).map((l) => (
              <option key={l.id} value={l.id}>
                {l.establishment_name}
              </option>
            ))}
          </select>
        </div>
        <div className="wa-preview" aria-live="polite">
          <div className="wa-bubble" data-testid="message-preview">
            {value.trim() ? highlight(rendered.text) : <span className="muted">A prévia aparecerá aqui.</span>}
          </div>
        </div>
        {rendered.missing.length > 0 && (
          <p className="small" style={{ color: "var(--warning)", margin: 0 }}>
            Este lead não possui: {rendered.missing.map((m) => `{{${m}}}`).join(", ")} — o trecho ficará vazio.
          </p>
        )}
        {waUrl && waUrl.ok && (
          <p className="small muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
            Link gerado: <code>{waUrl.url.slice(0, 120)}{waUrl.url.length > 120 ? "…" : ""}</code>
          </p>
        )}
      </div>
    </div>
  );
}
