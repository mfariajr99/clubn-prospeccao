import { CheckCircle2, Download, FileSpreadsheet, ListPlus, Megaphone, RotateCcw, TriangleAlert, UploadCloud, Users } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { applyMapping, autoMapColumns, IMPORT_FIELDS, mappingIsComplete, type ColumnMapping, type ImportField } from "../../shared/importMapping";
import { planRow, summarizePlan, type DuplicateMode, type RowDecision } from "../../shared/importPlan";
import type { ImportAnalysis, ImportAnalysisRow, ImportBatch, Paginated } from "../../shared/types";
import { AddToCampaignDialog } from "../components/AddToCampaignDialog";
import { useToast } from "../components/Toast";
import { ConfirmDialog, EmptyState, Pagination, SkeletonRows } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime, fmtNumber, fmtPhone } from "../lib/format";
import { IS_DEMO } from "../lib/env";
import { downloadTemplate, readSpreadsheet } from "../lib/readSpreadsheet";
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, extensionOf, type ParsedSheet } from "../lib/spreadsheetConstants";

type Step = "file" | "mapping" | "review" | "result";
const STEPS: { key: Step; label: string }[] = [
  { key: "file", label: "Arquivo" },
  { key: "mapping", label: "Colunas" },
  { key: "review", label: "Validação e prévia" },
  { key: "result", label: "Resultado" },
];
const PLAN_LABEL: Record<RowDecision | "error", string> = { import: "Importar", update: "Atualizar existente", skip: "Ignorar", error: "Com erro" };
const PLAN_TONE: Record<RowDecision | "error", string> = { import: "success", update: "info", skip: "", error: "danger" };
const BATCH_STATUS: Record<ImportBatch["status"], { label: string; tone: string }> = {
  processing: { label: "Processando", tone: "info" },
  completed: { label: "Concluído", tone: "success" },
  completed_with_errors: { label: "Concluído com erros", tone: "warning" },
  failed: { label: "Falhou", tone: "danger" },
};
const PAGE = 50;

type Result = ImportBatch & { report: unknown[] };

export default function ImportProspects() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "historico" ? "history" : "new";
  return (
    <>
      <div className="page-head">
        <div>
          <div className="breadcrumb">Leads</div>
          <h1>Importar prospects</h1>
          <p>Importe centenas ou milhares de prospects por planilha. Nada é gravado antes da sua confirmação, e a importação nunca envia mensagens.</p>
        </div>
        {IS_DEMO ? (
          <span className="small muted" style={{ maxWidth: 320 }}>
            Na demonstração os downloads (modelo e relatório) ficam desativados. Use uma planilha com as colunas: nome, segmento, bairro, cidade, estado, WhatsApp, link.
          </span>
        ) : (
          <button className="btn secondary" onClick={() => void downloadTemplate()}>
            <Download size={16} /> Baixar modelo de planilha
          </button>
        )}
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "new"} onClick={() => setParams({}, { replace: true })}>
          Nova importação
        </button>
        <button role="tab" aria-selected={tab === "history"} onClick={() => setParams({ tab: "historico" }, { replace: true })}>
          Histórico de lotes
        </button>
      </div>
      {tab === "new" ? <ImportWizard /> : <BatchHistory />}
    </>
  );
}

function ImportWizard() {
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("file");
  const [filename, setFilename] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [mapNotes, setMapNotes] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [mode, setMode] = useState<DuplicateMode>("skip");
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [busy, setBusy] = useState<null | "reading" | "analyzing" | "importing">(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [filterTab, setFilterTab] = useState<"all" | "valid" | "invalid" | "duplicates">("all");
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const reset = () => {
    setStep("file");
    setSheet(null);
    setMapping(null);
    setAnalysis(null);
    setDecisions({});
    setMode("skip");
    setResult(null);
    setFileError(null);
    setFilename("");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    if (!ACCEPTED_EXTENSIONS.includes(extensionOf(file.name))) return setFileError("Formato não suportado. Envie um arquivo .xlsx, .xls ou .csv.");
    if (file.size > MAX_FILE_BYTES) return setFileError("Arquivo muito grande (limite de 10 MB). Divida a planilha.");
    setBusy("reading");
    try {
      const parsed = await readSpreadsheet(file);
      const auto = autoMapColumns(parsed.headers);
      setFilename(file.name);
      setSheet(parsed);
      setMapping(auto.mapping);
      setMapNotes(auto.reasons);
      setStep("mapping");
    } catch (e) {
      setFileError(errorMessage(e));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void onFile(e.dataTransfer.files?.[0]);
  };

  const mappedRows = useMemo(() => (sheet && mapping ? applyMapping(sheet.rows, mapping, sheet.firstRowNumber) : []), [sheet, mapping]);

  const analyze = async () => {
    if (!mapping || !mappingIsComplete(mapping)) return;
    setBusy("analyzing");
    try {
      const res = await api.post<ImportAnalysis>("/imports/analyze", { filename, rows: mappedRows });
      setAnalysis(res);
      setDecisions({});
      setPage(1);
      setFilterTab("all");
      setStep("review");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const plan = useMemo(() => (analysis ? summarizePlan(analysis.rows, mode, decisions) : null), [analysis, mode, decisions]);
  const filteredRows = useMemo(() => {
    if (!analysis) return [];
    return analysis.rows.filter((r) => (filterTab === "valid" ? r.valid : filterTab === "invalid" ? !r.valid : filterTab === "duplicates" ? Boolean(r.duplicate) : true));
  }, [analysis, filterTab]);
  const pageRows = filteredRows.slice((page - 1) * PAGE, page * PAGE);
  const conflicts = analysis?.rows.filter((r) => r.duplicate && (r.duplicate.kind === "existing_phone" || r.duplicate.kind === "existing_name")) ?? [];
  const unresolved = mode === "review" ? conflicts.filter((r) => !decisions[String(r.rowNumber)]).length : 0;

  const commit = async () => {
    if (!analysis || busy) return;
    setBusy("importing");
    try {
      const res = await api.post<Result>("/imports/commit", { filename, rows: mappedRows, confirmed: true, duplicate_action: mode, decisions });
      setResult(res);
      setConfirming(false);
      setStep("result");
      toast.success("Importação concluída.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      <ol className="stepper" aria-label="Etapas da importação">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === stepIndex ? "current" : i < stepIndex ? "done" : ""} aria-current={i === stepIndex ? "step" : undefined}>
            <span className="n">{i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      {step === "file" && (
        <div className="card">
          <div
            className={`dropzone ${over ? "over" : ""}`}
            role="button"
            tabIndex={0}
            aria-label="Selecionar ou arrastar planilha"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <div className="dz-icon">{busy === "reading" ? <RotateCcw className="spin" size={26} /> : <UploadCloud size={28} />}</div>
            <h3 style={{ margin: "0 0 6px" }}>{busy === "reading" ? "Lendo arquivo…" : "Arraste a planilha aqui ou clique para selecionar"}</h3>
            <p className="muted" style={{ margin: 0 }}>
              Formatos aceitos: .xlsx, .xls e .csv · até 10 MB · até 10.000 linhas
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              hidden
              data-testid="file-input"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
          {fileError && (
            <div className="notice danger" style={{ marginTop: 14 }} role="alert">
              <TriangleAlert size={16} /> {fileError}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 14, marginBottom: 0 }}>
            Colunas esperadas: nome do estabelecimento, segmento, bairro, cidade, estado, WhatsApp e link. Pequenas variações de nome são reconhecidas automaticamente.
          </p>
        </div>
      )}

      {step === "mapping" && sheet && mapping && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Relacione as colunas</h2>
              <p className="card-sub" style={{ margin: 0 }}>
                <FileSpreadsheet size={14} style={{ verticalAlign: -2 }} /> {filename} · aba “{sheet.sheetName}” · {fmtNumber(mappedRows.length)} linha(s) com dados
                {sheet.sheetCount > 1 && " · somente a primeira aba com dados é lida"}
              </p>
            </div>
          </div>
          {mapNotes.length > 0 ? (
            <div className="notice warning" style={{ marginBottom: 12 }}>
              <TriangleAlert size={16} />
              <div>
                <strong>Revise o mapeamento:</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {mapNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="notice success" style={{ marginBottom: 12 }}>
              <CheckCircle2 size={16} /> Todas as colunas obrigatórias foram identificadas automaticamente. Confira antes de continuar.
            </div>
          )}
          <div>
            {IMPORT_FIELDS.map((field) => {
              const col = mapping[field.key];
              const sample = col !== null ? mappedRows.slice(0, 3).map((r) => r.values[field.key]).filter(Boolean).join(" · ") : "";
              return (
                <div className="mapping-row" key={field.key}>
                  <label htmlFor={`map-${field.key}`} style={{ fontWeight: 600 }}>
                    {field.label} {field.required && <span style={{ color: "var(--danger)" }}>*</span>}
                  </label>
                  <select
                    id={`map-${field.key}`}
                    className="select"
                    value={col ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value === "" ? null : Number(e.target.value) } as Record<ImportField, number | null>)}
                  >
                    <option value="">— Não importar —</option>
                    {sheet.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sample ? `Ex.: ${sample}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="form-actions">
            <button className="btn secondary" onClick={reset}>
              Escolher outro arquivo
            </button>
            <button className="btn" onClick={analyze} disabled={!mappingIsComplete(mapping) || busy === "analyzing"}>
              {busy === "analyzing" ? "Validando…" : "Validar registros"}
            </button>
          </div>
        </div>
      )}

      {step === "review" && analysis && plan && (
        <>
          <div className="card">
            <h2>Resumo antes da confirmação</h2>
            <p className="card-sub">Arquivo: {filename}. Nenhum registro foi gravado ainda.</p>
            <div className="summary-grid">
              <Summary label="Linhas encontradas" value={analysis.totalRows} />
              <Summary label="Registros válidos" value={analysis.validRows} tone="good" />
              <Summary label="Registros inválidos" value={analysis.invalidRows} tone={analysis.invalidRows ? "bad" : undefined} />
              <Summary label="Possíveis duplicidades" value={analysis.duplicateRows} tone={analysis.duplicateRows ? "warn" : undefined} />
              <Summary label="Serão importados" value={plan.import} tone="good" />
              <Summary label="Serão atualizados" value={plan.update} />
              <Summary label="Serão ignorados" value={plan.skip} />
            </div>

            {analysis.duplicateRows > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: "18px 0 0" }}>
                <legend style={{ fontWeight: 700, marginBottom: 8 }}>O que fazer com duplicidades?</legend>
                <div className="segmented" role="radiogroup">
                  {(
                    [
                      ["skip", "Ignorar duplicados"],
                      ["update", "Atualizar existentes com dados novos"],
                      ["review", "Revisar conflitos"],
                    ] as [DuplicateMode, string][]
                  ).map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={mode === value} aria-pressed={mode === value} onClick={() => setMode(value)}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  WhatsApp repetido dentro da planilha: apenas a primeira ocorrência é considerada. Registros existentes nunca são sobrescritos sem a sua escolha.
                </p>
                {mode === "review" && unresolved > 0 && (
                  <div className="notice warning" style={{ marginTop: 10 }}>
                    <TriangleAlert size={16} /> {unresolved} conflito(s) sem decisão serão ignorados. Use a aba “Duplicidades” para decidir linha a linha.
                  </div>
                )}
              </fieldset>
            )}
          </div>

          <div className="card">
            <div className="tabs" role="tablist">
              {(
                [
                  ["all", `Todos (${analysis.totalRows})`],
                  ["valid", `Válidos (${analysis.validRows})`],
                  ["invalid", `Inválidos (${analysis.invalidRows})`],
                  ["duplicates", `Duplicidades (${analysis.duplicateRows})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={filterTab === key}
                  onClick={() => {
                    setFilterTab(key);
                    setPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {pageRows.length === 0 ? (
              <EmptyState title="Nenhum registro nesta aba" />
            ) : (
              <div className="list-view">
                <ul className="import-rows" aria-label="Registros da planilha">
                  {pageRows.map((row) => (
                    <PreviewRow
                      key={row.rowNumber}
                      row={row}
                      plan={planRow(row, mode, decisions)}
                      reviewable={mode === "review" && Boolean(row.duplicate) && (row.duplicate?.kind === "existing_phone" || row.duplicate?.kind === "existing_name")}
                      decision={decisions[String(row.rowNumber)]}
                      onDecision={(d) => setDecisions((all) => ({ ...all, [String(row.rowNumber)]: d }))}
                    />
                  ))}
                </ul>
              </div>
            )}
            <Pagination page={page} pageSize={PAGE} total={filteredRows.length} onPage={setPage} />
          </div>

          <div className="form-actions">
            <button className="btn secondary" onClick={() => setStep("mapping")} disabled={Boolean(busy)}>
              Voltar ao mapeamento
            </button>
            <button className="btn" onClick={() => setConfirming(true)} disabled={plan.import + plan.update === 0 || Boolean(busy)}>
              Confirmar importação
            </button>
          </div>
          <ConfirmDialog
            open={confirming}
            title="Confirmar importação"
            confirmLabel={busy === "importing" ? "Importando…" : "Importar agora"}
            busy={busy === "importing"}
            onCancel={() => setConfirming(false)}
            onConfirm={commit}
          >
            <p style={{ marginTop: 0 }}>
              Arquivo <strong>{filename}</strong>
            </p>
            <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
              <li>{fmtNumber(plan.import)} prospect(s) serão importados com status “Prospect”;</li>
              <li>{fmtNumber(plan.update)} registro(s) existentes serão atualizados;</li>
              <li>{fmtNumber(plan.skip)} serão ignorados e {fmtNumber(plan.error)} possuem erro.</li>
            </ul>
            <p className="small muted">A importação não envia mensagens e não adiciona nada a filas.</p>
          </ConfirmDialog>
        </>
      )}

      {step === "result" && result && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Importação concluída — lote #{result.id}</h2>
              <p className="card-sub" style={{ margin: 0 }}>
                {result.original_filename} · {fmtDateTime(result.completed_at)} · {result.imported_by_name}
              </p>
            </div>
            <span className={`badge ${BATCH_STATUS[result.status].tone}`}>{BATCH_STATUS[result.status].label}</span>
          </div>
          <div className="summary-grid">
            <Summary label="Importados" value={result.imported_rows} tone="good" />
            <Summary label="Atualizados" value={result.updated_rows} />
            <Summary label="Ignorados" value={result.skipped_rows} />
            <Summary label="Com erro" value={result.error_rows} tone={result.error_rows ? "bad" : undefined} />
            <Summary label="Duplicados identificados" value={result.duplicate_rows} tone={result.duplicate_rows ? "warn" : undefined} />
          </div>
          <div className="btn-row" style={{ marginTop: 18 }}>
            {!IS_DEMO && <a className="btn secondary" href={`/api/imports/${result.id}/report.csv`} download>
              <Download size={16} /> Baixar relatório
            </a>}
            <Link className="btn secondary" to={`/leads?batch_id=${result.id}`}>
              <Users size={16} /> Ver prospects do lote
            </Link>
            <button className="btn secondary" onClick={() => setAddOpen(true)} disabled={result.imported_rows + result.updated_rows === 0}>
              <ListPlus size={16} /> Adicionar a uma campanha
            </button>
            <button className="btn" onClick={() => navigate(`/campanhas/nova?batch_id=${result.id}`)} disabled={result.imported_rows + result.updated_rows === 0}>
              <Megaphone size={16} /> Criar campanha com este lote
            </button>
            <button className="btn ghost" onClick={reset}>
              Nova importação
            </button>
          </div>
          <AddToCampaignDialog
            open={addOpen}
            selection={{ filter: { batch_id: String(result.id) }, count: result.imported_rows + result.updated_rows }}
            onClose={() => setAddOpen(false)}
          />
        </div>
      )}
    </>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className={`summary-item ${tone ?? ""}`}>
      <div className="si-label">{label}</div>
      <div className="si-value mono">{fmtNumber(value)}</div>
    </div>
  );
}

function PreviewRow({
  row,
  plan,
  reviewable,
  decision,
  onDecision,
}: {
  row: ImportAnalysisRow;
  plan: RowDecision | "error";
  reviewable: boolean;
  decision?: RowDecision;
  onDecision: (d: RowDecision) => void;
}) {
  const lead = row.lead;
  return (
    <li className="import-row">
      <span className="ir-line mono">Linha {row.rowNumber}</span>
      <div className="ir-lead">
        <div className="cell-title">{lead?.establishment_name ?? (row.values.establishment_name || "—")}</div>
        <div className="cell-sub">
          {[lead?.segment ?? row.values.segment, lead ? `${lead.city}/${lead.state}` : [row.values.city, row.values.state].filter(Boolean).join("/")].filter(Boolean).join(" · ") || "—"}
        </div>
        <div className="cell-sub mono">{lead ? fmtPhone(lead.whatsapp) : row.values.whatsapp || "Sem WhatsApp"}</div>
      </div>
      <div className="ir-status">
        {!row.valid ? (
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--danger)" }} className="small">
            {row.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : row.duplicate ? (
          <span className="small" style={{ color: "var(--warning)" }}>
            {row.duplicate.message}
          </span>
        ) : (
          <span className="small" style={{ color: "var(--success)" }}>
            Válido
          </span>
        )}
      </div>
      <div className="ir-action">
        {reviewable ? (
          <select className="select" style={{ height: 36 }} aria-label={`Decisão para a linha ${row.rowNumber}`} value={decision ?? ""} onChange={(e) => onDecision(e.target.value as RowDecision)}>
            <option value="">Decidir…</option>
            <option value="skip">Ignorar</option>
            <option value="update">Atualizar existente</option>
            {row.duplicate?.kind === "existing_name" && <option value="import">Importar como novo</option>}
          </select>
        ) : (
          <span className={`badge ${PLAN_TONE[plan]}`}>{PLAN_LABEL[plan]}</span>
        )}
      </div>
    </li>
  );
}

function BatchHistory() {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useAsync((s) => api.get<Paginated<ImportBatch>>("/imports", { page, pageSize: 20 }, s), [page]);
  if (loading && !data) return <SkeletonRows rows={5} />;
  if (error) return <div className="notice danger">{error}</div>;
  if (!data || data.items.length === 0) return <EmptyState title="Nenhuma importação ainda" description="Os lotes importados aparecerão aqui." />;
  return (
    <div className="card">
      <ul className="batch-list">
        {data.items.map((b) => (
          <li key={b.id} className="batch-item">
            <div className="bi-main">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="cell-title">Lote #{b.id}</span>
                <span className={`badge ${BATCH_STATUS[b.status].tone}`}>{BATCH_STATUS[b.status].label}</span>
              </div>
              <div className="cell-sub" style={{ overflowWrap: "anywhere" }}>{b.original_filename}</div>
              <div className="cell-sub">
                {fmtDateTime(b.created_at)} · {b.imported_by_name ?? "—"}
              </div>
            </div>
            <dl className="bi-counts">
              <div><dt>Total</dt><dd className="mono">{fmtNumber(b.total_rows)}</dd></div>
              <div><dt>Importados</dt><dd className="mono">{fmtNumber(b.imported_rows)}</dd></div>
              <div><dt>Atualizados</dt><dd className="mono">{fmtNumber(b.updated_rows)}</dd></div>
              <div><dt>Ignorados</dt><dd className="mono">{fmtNumber(b.skipped_rows)}</dd></div>
              <div><dt>Com erro</dt><dd className="mono">{fmtNumber(b.error_rows)}</dd></div>
            </dl>
            <div className="bi-actions">
              <Link className="btn secondary xs" to={`/leads?batch_id=${b.id}`}>
                Ver prospects
              </Link>
              {!IS_DEMO && (
                <a className="icon-btn" href={`/api/imports/${b.id}/report.csv`} download aria-label={`Baixar relatório do lote ${b.id}`} data-tooltip="Baixar relatório">
                  <Download size={15} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </div>
  );
}
