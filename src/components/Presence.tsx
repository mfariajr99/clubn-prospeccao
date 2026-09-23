import { Camera, ExternalLink, Eye, Globe, Link2, MapPin, Music2, ThumbsUp, Unlink } from "lucide-react";
import type { ReactNode } from "react";
import { LINK_TYPE_LABELS, type LinkType } from "../../shared/constants";
import { linkLabel } from "../../shared/url";
import { IconButton } from "./ui";

export function LinkTypeIcon({ type, size = 16 }: { type: LinkType | null | undefined; size?: number }) {
  switch (type) {
    case "instagram":
      return <Camera size={size} aria-hidden />;
    case "facebook":
      return <ThumbsUp size={size} aria-hidden />;
    case "tiktok":
      return <Music2 size={size} aria-hidden />;
    case "google_maps":
      return <MapPin size={size} aria-hidden />;
    case "linktree":
      return <Link2 size={size} aria-hidden />;
    case "site":
      return <Globe size={size} aria-hidden />;
    default:
      return <Link2 size={size} aria-hidden />;
  }
}

/** Real link to the original address: new tab, no opener, no referrer. */
export function ExternalLink2({ url, className = "btn secondary sm", children, label }: { url: string; className?: string; children: ReactNode; label?: string }) {
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer" aria-label={label} data-tooltip={className.includes("icon-btn") ? label : undefined}>
      {children}
    </a>
  );
}

interface Props {
  url: string | null;
  type: LinkType | null;
  extraCount?: number;
  onPreview?: () => void;
  compact?: boolean;
}

/** "Presença digital" cell: icon, domain/user, "Ver prévia" and "Abrir link". */
export function PresenceCell({ url, type, extraCount = 0, onPreview, compact }: Props) {
  if (!url) {
    return (
      <span className="presence muted small">
        <span className="p-icon" aria-hidden>
          <Unlink size={14} />
        </span>
        Sem link
      </span>
    );
  }
  const label = linkLabel(url);
  return (
    <span className="presence">
      <span className="p-icon" title={LINK_TYPE_LABELS[type ?? "other"]}>
        <LinkTypeIcon type={type} size={15} />
        <span className="sr-only">{LINK_TYPE_LABELS[type ?? "other"]}</span>
      </span>
      <span className="p-label" title={url}>
        {label}
        {extraCount > 0 && <span className="muted"> +{extraCount}</span>}
      </span>
      {!compact && (
        <span className="p-actions">
          {onPreview && (
            <IconButton label="Ver prévia" onClick={onPreview}>
              <Eye size={15} />
            </IconButton>
          )}
          <ExternalLink2 url={url} className="icon-btn" label="Abrir link">
            <ExternalLink size={15} />
          </ExternalLink2>
        </span>
      )}
    </span>
  );
}
