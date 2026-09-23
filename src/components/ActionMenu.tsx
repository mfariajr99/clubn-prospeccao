import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export type ActionItem =
  | { label: string; icon?: ReactNode; to: string; hidden?: boolean; danger?: boolean }
  | { label: string; icon?: ReactNode; onClick: () => void; hidden?: boolean; danger?: boolean; disabled?: boolean };

/**
 * "Mais ações" menu. Rendered with position: fixed so it is never clipped by
 * scrollable tables or cards, and flips upward near the bottom of the screen.
 */
export function ActionMenu({ items, label = "Mais ações" }: { items: ActionItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = items.filter((i) => !i.hidden);

  const place = () => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 220;
    const menuW = menuRef.current?.offsetWidth ?? 220;
    const below = r.bottom + 6 + menuH <= window.innerHeight - 8;
    const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - menuH);
    const left = Math.min(Math.max(8, r.right - menuW), window.innerWidth - menuW - 8);
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Follow the button when the page or a list scrolls instead of closing.
    const onScroll = () => place();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label={label}
        data-tooltip={open ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          className="action-menu"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const els = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const i = els.indexOf(document.activeElement as HTMLElement);
            els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus({ preventScroll: true });
          }}
        >
          {visible.map((item) =>
            "to" in item ? (
              <Link key={item.label} role="menuitem" to={item.to} className={item.danger ? "danger" : ""} onClick={() => setOpen(false)}>
                {item.icon}
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                className={item.danger ? "danger" : ""}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
