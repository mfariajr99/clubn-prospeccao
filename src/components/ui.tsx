import { ChevronLeft, ChevronRight, Inbox, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  CAMPAIGN_STATUS_LABELS,
  CONTACT_STATUS_LABELS,
  POTENTIAL_LABELS,
  PREVIEW_STATUS_LABELS,
  REGISTRATION_STATUS_LABELS,
  type CampaignStatus,
  type ContactStatus,
  type PotentialLevel,
  type PreviewStatus,
  type RegistrationStatus,
} from "../../shared/constants";
import { useIsMobile } from "../hooks/useMediaQuery";
import { fmtNumber } from "../lib/format";

// ---------------------------------------------------------------- Badges
const CONTACT_TONE: Record<ContactStatus, string> = {
  not_contacted: "",
  whatsapp_opened: "info",
  message_sent: "purple",
  replied: "warning",
  interested: "success",
  not_interested: "danger",
  partnership: "navy",
};
export function ContactBadge({ status }: { status: ContactStatus }) {
  return (
    <span className={`badge ${CONTACT_TONE[status] ?? ""}`}>
      <span className="dot" aria-hidden />
      {CONTACT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const REG_TONE: Record<RegistrationStatus, string> = { prospect: "outline", qualified: "info", client: "success", inactive: "" };
export function RegistrationBadge({ status }: { status: RegistrationStatus }) {
  return <span className={`badge ${REG_TONE[status]}`}>{REGISTRATION_STATUS_LABELS[status] ?? status}</span>;
}

const CAMPAIGN_TONE: Record<CampaignStatus, string> = { draft: "", ready: "info", in_progress: "success", paused: "warning", completed: "navy" };
export function CampaignBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`badge ${CAMPAIGN_TONE[status]}`}>
      <span className="dot" aria-hidden />
      {CAMPAIGN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const POTENTIAL_TONE: Record<PotentialLevel | "none", string> = { high: "success", medium: "warning", low: "danger", none: "outline" };
export function PotentialBadge({ level }: { level: PotentialLevel | null | undefined }) {
  const key = level ?? "none";
  return <span className={`badge ${POTENTIAL_TONE[key]}`}>{POTENTIAL_LABELS[key]}</span>;
}

const PREVIEW_TONE: Record<PreviewStatus, string> = {
  not_requested: "",
  pending: "info",
  processing: "info",
  available: "success",
  stale: "warning",
  blocked: "warning",
  invalid_link: "danger",
  error: "danger",
};
export function PreviewBadge({ status }: { status: PreviewStatus }) {
  return <span className={`badge ${PREVIEW_TONE[status]}`}>{PREVIEW_STATUS_LABELS[status]}</span>;
}

// ---------------------------------------------------------------- Buttons
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  tone?: "whatsapp" | "plain";
}
/** Icon-only button: always has aria-label + visible tooltip. */
export function IconButton({ label, children, tone, className = "", ...rest }: IconButtonProps) {
  return (
    <button type="button" aria-label={label} data-tooltip={label} className={`icon-btn ${tone ?? ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Empty / skeleton
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-icon">{icon ?? <Inbox size={24} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Pagination
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="Paginação">
      <span>
        {fmtNumber(from)}–{fmtNumber(to)} de {fmtNumber(total)}
      </span>
      <div className="pages">
        <IconButton label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={18} />
        </IconButton>
        <span className="mono">
          {page} / {pages}
        </span>
        <IconButton label="Próxima página" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={18} />
        </IconButton>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- Overlays
function useOverlayBehavior(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button:not([disabled])");
    focusable?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && node) {
        const items = [...node.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export function Modal({ open, title, onClose, children, actions, wide, description }: { open: boolean; title: string; onClose: () => void; children?: ReactNode; actions?: ReactNode; wide?: boolean; description?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlayBehavior(open, onClose, ref);
  if (!open) return null;
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div ref={ref} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 id={id}>{title}</h2>
            {description && <p className="muted" style={{ margin: 0 }}>{description}</p>}
          </div>
          <IconButton label="Fechar" tone="plain" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div style={{ marginTop: 14 }}>{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  danger,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className={`btn ${danger ? "danger" : ""}`} onClick={onConfirm} disabled={busy} data-autofocus>
            {busy ? "Aguarde…" : confirmLabel}
          </button>
        </>
      }
    >
      {message && <p style={{ margin: 0 }}>{message}</p>}
      {children}
    </Modal>
  );
}

/** Side panel on desktop, full-screen bottom sheet on mobile. */
export function ResponsivePanel({
  open,
  title,
  onClose,
  children,
  footer,
  headerExtra,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlayBehavior(open, onClose, ref);
  if (!open) return null;
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside
        ref={ref}
        className={`side-panel ${isMobile ? "sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        data-variant={isMobile ? "sheet" : "side"}
        data-testid="preview-panel"
      >
        {isMobile && <div className="sheet-handle" aria-hidden />}
        <div className="panel-head">
          <h2 id={id}>{title}</h2>
          {headerExtra}
          <IconButton label="Fechar" tone="plain" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="panel-body">{children}</div>
        {footer && <div className="panel-foot">{footer}</div>}
      </aside>
    </>
  );
}

export function Field({ label, required, error, hint, children, className = "", htmlFor }: { label: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${error ? "invalid" : ""} ${className}`}>
      <label htmlFor={htmlFor}>
        {label} {required && <span className="req" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="hint">{hint}</span>
      )}
    </div>
  );
}
