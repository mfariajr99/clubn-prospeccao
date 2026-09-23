import { Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  EVALUATION_CHECKLIST,
  POTENTIAL_LABELS,
  POTENTIAL_LEVELS,
  QUALITY_LABELS,
  QUALITY_LEVELS,
  type PotentialLevel,
  type QualityLevel,
} from "../../shared/constants";
import type { Evaluation } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useToast } from "./Toast";
import { Field, PotentialBadge } from "./ui";

interface Props {
  leadId: number;
  campaignId?: number | null;
  campaignName?: string | null;
  onSaved?: (evaluation: Evaluation) => void;
}

type Scope = "general" | "campaign";

const QUALITY_FIELDS = [
  { key: "digital_presence_quality", label: "Qualidade da presença digital" },
  { key: "campaign_compatibility", label: "Compatibilidade com a campanha" },
  { key: "perceived_popularity", label: "Popularidade percebida" },
  { key: "visual_quality", label: "Qualidade visual" },
] as const;
type QualityKey = (typeof QUALITY_FIELDS)[number]["key"];

/** Manual prospect evaluation. No metric is inferred automatically. */
export function EvaluationForm({ leadId, campaignId, campaignName, onSaved }: Props) {
  const toast = useToast();
  const [evaluations, setEvaluations] = useState<Evaluation[] | null>(null);
  const [scope, setScope] = useState<Scope>(campaignId ? "campaign" : "general");
  const [potential, setPotential] = useState<PotentialLevel | null>(null);
  const [score, setScore] = useState(0);
  const [quality, setQuality] = useState<Record<QualityKey, QualityLevel | "">>({
    digital_presence_quality: "",
    campaign_compatibility: "",
    perceived_popularity: "",
    visual_quality: "",
  });
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ potential?: string; score?: string }>({});

  useEffect(() => {
    let active = true;
    api
      .get<Evaluation[]>(`/leads/${leadId}/evaluations`)
      .then((list) => active && setEvaluations(list))
      .catch(() => active && setEvaluations([]));
    return () => {
      active = false;
    };
  }, [leadId]);

  const current = useMemo(
    () => evaluations?.find((e) => (scope === "campaign" ? e.campaign_id === campaignId : e.campaign_id === null)) ?? null,
    [evaluations, scope, campaignId],
  );

  useEffect(() => {
    setPotential(current?.potential_level ?? null);
    setScore(current?.score ?? 0);
    setQuality({
      digital_presence_quality: current?.digital_presence_quality ?? "",
      campaign_compatibility: current?.campaign_compatibility ?? "",
      perceived_popularity: current?.perceived_popularity ?? "",
      visual_quality: current?.visual_quality ?? "",
    });
    setChecklist(current?.checklist_data ?? {});
    setNotes(current?.notes ?? "");
    setErrors({});
  }, [current]);

  const save = async () => {
    const nextErrors: typeof errors = {};
    if (!potential) nextErrors.potential = "Selecione o potencial.";
    if (score < 1) nextErrors.score = "Dê uma nota de 1 a 5.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || busy) return;
    setBusy(true);
    try {
      const saved = await api.put<Evaluation>(`/leads/${leadId}/evaluations`, {
        campaign_id: scope === "campaign" ? campaignId : null,
        potential_level: potential,
        score,
        digital_presence_quality: quality.digital_presence_quality || null,
        campaign_compatibility: quality.campaign_compatibility || null,
        perceived_popularity: quality.perceived_popularity || null,
        visual_quality: quality.visual_quality || null,
        checklist_data: checklist,
        notes: notes.trim() || null,
      });
      setEvaluations((list) => [...(list ?? []).filter((e) => e.id !== saved.id), saved]);
      toast.success("Avaliação registrada.");
      onSaved?.(saved);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!evaluations) return <div className="skeleton" style={{ height: 200 }} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label="Avaliação do prospect">
      {campaignId && (
        <div className="segmented" role="group" aria-label="Escopo da avaliação">
          <button type="button" aria-pressed={scope === "general"} onClick={() => setScope("general")}>
            Avaliação geral
          </button>
          <button type="button" aria-pressed={scope === "campaign"} onClick={() => setScope("campaign")}>
            Para esta campanha
          </button>
        </div>
      )}
      {scope === "campaign" && campaignName && <p className="small muted" style={{ margin: 0 }}>Campanha: {campaignName}</p>}
      {current ? (
        <p className="small muted" style={{ margin: 0 }}>
          <PotentialBadge level={current.potential_level} /> Avaliado por <strong>{current.evaluator_name ?? "—"}</strong> em {fmtDateTime(current.updated_at)}
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Ainda não avaliado{scope === "campaign" ? " para esta campanha" : ""}.
        </p>
      )}

      <Field label="Potencial" required error={errors.potential}>
        <div className="segmented" role="group" aria-label="Potencial">
          {POTENTIAL_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={potential === level} onClick={() => setPotential(level)}>
              {POTENTIAL_LABELS[level].replace(" potencial", "")}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Nota" required error={errors.score}>
        <div className="stars" role="group" aria-label="Nota de 1 a 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={score >= n} aria-label={`Nota ${n}`} onClick={() => setScore(n)}>
              <Star size={22} fill={score >= n ? "currentColor" : "none"} />
            </button>
          ))}
        </div>
      </Field>
      <div className="form-grid">
        {QUALITY_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`q-${f.key}`}>
            <select id={`q-${f.key}`} className="select" value={quality[f.key]} onChange={(e) => setQuality((q) => ({ ...q, [f.key]: e.target.value as QualityLevel | "" }))}>
              <option value="">Não informado</option>
              {QUALITY_LEVELS.map((q) => (
                <option key={q} value={q}>
                  {QUALITY_LABELS[q]}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>
          Checklist (opcional)
        </legend>
        <div style={{ display: "grid", gap: 8 }}>
          {EVALUATION_CHECKLIST.map((item) => (
            <label key={item.key} className="checkbox">
              <input type="checkbox" checked={Boolean(checklist[item.key])} onChange={(e) => setChecklist((c) => ({ ...c, [item.key]: e.target.checked }))} />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Observações do avaliador" htmlFor="eval-notes">
        <textarea id="eval-notes" className="textarea" style={{ minHeight: 80 }} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <button className="btn" onClick={save} disabled={busy}>
        {busy ? "Salvando…" : "Salvar avaliação"}
      </button>
    </div>
  );
}
