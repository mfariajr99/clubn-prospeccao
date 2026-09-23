import { CheckCircle2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LINK_TYPE_LABELS, REGISTRATION_STATUSES, REGISTRATION_STATUS_LABELS, type RegistrationStatus } from "../../shared/constants";
import { normalizeLeadInput, type LeadField } from "../../shared/leadInput";
import { normalizePhone } from "../../shared/phone";
import { BRAZIL_STATES, normalizeState } from "../../shared/states";
import type { Lead } from "../../shared/types";
import { normalizeUrl } from "../../shared/url";
import { LinkTypeIcon } from "../components/Presence";
import { useToast } from "../components/Toast";
import { ConfirmDialog, Field, IconButton, SkeletonRows } from "../components/ui";
import { ApiError, api, errorMessage } from "../lib/api";

interface FormState {
  establishment_name: string;
  segment: string;
  neighborhood: string;
  city: string;
  state: string;
  whatsapp: string;
  digital_presence_url: string;
  extra_links: string[];
  cover_image_url: string;
  registration_status: RegistrationStatus;
}

const EMPTY: FormState = {
  establishment_name: "",
  segment: "",
  neighborhood: "",
  city: "",
  state: "",
  whatsapp: "",
  digital_presence_url: "",
  extra_links: [],
  cover_image_url: "",
  registration_status: "prospect",
};

type Errors = Partial<Record<LeadField, string>>;

function fromLead(lead: Lead): FormState {
  return {
    establishment_name: lead.establishment_name,
    segment: lead.segment,
    neighborhood: lead.neighborhood,
    city: lead.city,
    state: lead.state,
    whatsapp: lead.whatsapp_valid ? `+${lead.whatsapp}` : lead.whatsapp,
    digital_presence_url: lead.digital_presence_url ?? "",
    extra_links: (lead.links ?? []).filter((l) => !l.is_primary).map((l) => l.url),
    cover_image_url: lead.cover_image_url ?? "",
    registration_status: lead.registration_status,
  };
}

export default function LeadForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    if (!id) return;
    api
      .get<Lead>(`/leads/${id}`)
      .then((lead) => setForm(fromLead(lead)))
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id, toast]);

  const validation = useMemo(() => normalizeLeadInput({ ...form, extra_links: form.extra_links.filter((l) => l.trim()) }), [form]);
  const liveErrors: Errors = validation.ok ? {} : validation.errors;
  const shownError = (field: LeadField) => errors[field] ?? (touched[field as keyof FormState] ? liveErrors[field] : undefined);

  const phonePreview = useMemo(() => {
    if (!form.whatsapp.trim()) return null;
    const r = normalizePhone(form.whatsapp);
    return r.ok ? r.display : null;
  }, [form.whatsapp]);
  const linkPreview = useMemo(() => {
    const r = normalizeUrl(form.digital_presence_url);
    return r.ok && !r.empty ? r : null;
  }, [form.digital_presence_url]);
  const statePreview = form.state.trim() ? normalizeState(form.state) : null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const blur = (key: keyof FormState) => setTouched((t) => ({ ...t, [key]: true }));

  // Early duplicate warning (does not block: the server decides).
  const checkDuplicates = async () => {
    if (!validation.ok) return setDupWarning(null);
    try {
      const result = await api.post<{ phone: Lead | null; nameLocation: Lead[] }>("/leads/check-duplicates", { ...form, exclude_id: id ? Number(id) : undefined });
      if (result.phone) setDupWarning(`Já existe um lead com este WhatsApp: ${result.phone.establishment_name}.`);
      else if (result.nameLocation.length) setDupWarning(`Possível duplicidade: "${result.nameLocation[0].establishment_name}" já existe nesta cidade/estado.`);
      else setDupWarning(null);
    } catch {
      setDupWarning(null);
    }
  };

  const submit = async (e?: FormEvent, allowDuplicate = false) => {
    e?.preventDefault();
    if (submitting.current) return; // prevents double submit
    setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
    if (!validation.ok) {
      setErrors(validation.errors);
      const first = Object.keys(validation.errors)[0];
      document.getElementById(`lead-${first}`)?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const body = { ...form, extra_links: form.extra_links.filter((l) => l.trim()), allow_possible_duplicate: allowDuplicate };
      const saved = editing ? await api.put<Lead>(`/leads/${id}`, body) : await api.post<Lead>("/leads", body);
      toast.success(editing ? "Lead atualizado com sucesso." : "Lead cadastrado com sucesso.", { label: "Ver lead", onClick: () => navigate(`/leads/${saved.id}`) });
      if (editing) navigate(`/leads/${saved.id}`);
      else {
        setForm(EMPTY);
        setTouched({});
        setDupWarning(null);
        document.getElementById("lead-establishment_name")?.focus();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.details as { possible_duplicate?: boolean })?.possible_duplicate) {
        setConfirmDuplicate(true);
      } else if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields as Errors);
        toast.error(err.message);
      } else toast.error(errorMessage(err));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={8} />;

  const input = (key: keyof FormState & LeadField, label: string, opts: { required?: boolean; placeholder?: string; hint?: React.ReactNode; type?: string; full?: boolean; onBlur?: () => void; autoComplete?: string } = {}) => (
    <Field label={label} required={opts.required} error={shownError(key)} hint={opts.hint} className={opts.full ? "full" : ""} htmlFor={`lead-${key}`}>
      <input
        id={`lead-${key}`}
        className="input"
        type={opts.type ?? "text"}
        value={form[key] as string}
        placeholder={opts.placeholder}
        autoComplete={opts.autoComplete ?? "off"}
        aria-invalid={Boolean(shownError(key))}
        aria-required={opts.required}
        onChange={(e) => set(key, e.target.value as never)}
        onBlur={() => {
          blur(key);
          opts.onBlur?.();
        }}
      />
    </Field>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="breadcrumb">
            <Link to="/leads">Leads</Link> / {editing ? "Editar" : "Cadastrar"}
          </div>
          <h1>{editing ? "Editar lead" : "Cadastrar lead"}</h1>
          <p>{editing ? "Atualize os dados do estabelecimento." : "Cadastro individual de um lead ou prospect."}</p>
        </div>
      </div>

      <form className="card" onSubmit={submit} noValidate aria-busy={saving}>
        <div className="form-grid">
          {input("establishment_name", "Nome do estabelecimento", { required: true, placeholder: "Ex.: Café Exemplo", full: true, onBlur: checkDuplicates })}
          {input("segment", "Segmento", { placeholder: "Ex.: Restaurante, Academia, Pet shop" })}
          {input("neighborhood", "Bairro", { placeholder: "Ex.: Centro" })}
          {input("city", "Cidade", { required: true, placeholder: "Ex.: São Paulo", onBlur: checkDuplicates })}
          <Field
            label="Estado"
            required
            error={shownError("state")}
            htmlFor="lead-state"
            hint={statePreview ? `UF: ${statePreview} — ${BRAZIL_STATES[statePreview]}` : "Digite a UF ou o nome do estado"}
          >
            <input
              id="lead-state"
              className="input"
              list="uf-list"
              value={form.state}
              placeholder="Ex.: SP ou São Paulo"
              aria-invalid={Boolean(shownError("state"))}
              onChange={(e) => set("state", e.target.value)}
              onBlur={() => {
                blur("state");
                if (statePreview) set("state", statePreview);
                void checkDuplicates();
              }}
            />
            <datalist id="uf-list">
              {Object.entries(BRAZIL_STATES).map(([uf, name]) => (
                <option key={uf} value={uf}>
                  {name}
                </option>
              ))}
            </datalist>
          </Field>
          {input("whatsapp", "WhatsApp de contato", {
            required: true,
            type: "tel",
            placeholder: "(11) 98765-4321",
            autoComplete: "tel",
            onBlur: checkDuplicates,
            hint: phonePreview ? (
              <span>
                <CheckCircle2 size={13} style={{ verticalAlign: -2, color: "var(--success)" }} /> Será salvo como {phonePreview}
              </span>
            ) : (
              "DDD + número. O código 55 é adicionado automaticamente para números do Brasil."
            ),
          })}
          <Field
            label="Link de presença digital"
            error={shownError("digital_presence_url")}
            className="full"
            htmlFor="lead-digital_presence_url"
            hint={
              linkPreview ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <LinkTypeIcon type={linkPreview.type} size={13} /> {LINK_TYPE_LABELS[linkPreview.type]} · {linkPreview.label}
                </span>
              ) : (
                "Instagram (@perfil), site, Facebook, TikTok, Linktree, Google Maps ou outro endereço público."
              )
            }
          >
            <input
              id="lead-digital_presence_url"
              className="input"
              value={form.digital_presence_url}
              placeholder="@perfil ou https://..."
              aria-invalid={Boolean(shownError("digital_presence_url"))}
              onChange={(e) => set("digital_presence_url", e.target.value)}
              onBlur={() => {
                blur("digital_presence_url");
                if (linkPreview) set("digital_presence_url", linkPreview.url);
              }}
            />
          </Field>
          <div className="field full">
            <span className="label">Outros links (opcional)</span>
            {form.extra_links.map((link, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  aria-label={`Link adicional ${i + 1}`}
                  value={link}
                  placeholder="https://..."
                  onChange={(e) => set("extra_links", form.extra_links.map((l, j) => (j === i ? e.target.value : l)))}
                />
                <IconButton label="Remover link" onClick={() => set("extra_links", form.extra_links.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))}
            {errors.extra_links || liveErrors.extra_links ? <span className="error">{errors.extra_links ?? liveErrors.extra_links}</span> : null}
            {form.extra_links.length < 3 && (
              <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => set("extra_links", [...form.extra_links, ""])}>
                <Plus size={15} /> Adicionar outro link
              </button>
            )}
          </div>
          {input("cover_image_url", "Imagem de capa (opcional)", {
            placeholder: "https://.../imagem.jpg",
            hint: "Usada como prévia quando a plataforma não permite captura (ex.: Instagram).",
          })}
          <Field label="Status cadastral" htmlFor="lead-registration_status">
            <select id="lead-registration_status" className="select" value={form.registration_status} onChange={(e) => set("registration_status", e.target.value as RegistrationStatus)}>
              {REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REGISTRATION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {dupWarning && (
          <div className="notice warning" style={{ marginTop: 16 }} role="status">
            <TriangleAlert size={16} /> {dupWarning}
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={() => navigate(-1)} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Salvando…" : editing ? "Salvar alterações" : "Salvar lead"}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDuplicate}
        title="Possível duplicidade"
        message="Já existe um lead com o mesmo nome, cidade e estado. Deseja salvar mesmo assim?"
        confirmLabel="Salvar mesmo assim"
        busy={saving}
        onCancel={() => setConfirmDuplicate(false)}
        onConfirm={() => {
          setConfirmDuplicate(false);
          void submit(undefined, true);
        }}
      />
    </>
  );
}
