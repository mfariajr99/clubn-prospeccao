import { ChevronDown, LayoutGrid, LogOut, Megaphone, Menu, PanelLeftClose, PanelLeftOpen, Users, X } from "lucide-react";
import { logout } from "./AuthGate";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { initials } from "../lib/format";
import { QuotaBadge } from "./Quota";
import { useSession } from "./Session";
import { useToast } from "./Toast";
import { Field, Modal } from "./ui";
import { errorMessage } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}
interface NavGroup {
  id: string;
  label: string;
  icon: ReactNode;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    id: "campanhas",
    label: "Campanhas",
    icon: <Megaphone size={19} aria-hidden />,
    items: [
      { to: "/campanhas/nova", label: "Criar campanha" },
      { to: "/campanhas", label: "Consultar campanhas", end: true },
      { to: "/campanhas/iniciar", label: "Iniciar campanhas" },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    icon: <Users size={19} aria-hidden />,
    items: [
      { to: "/leads/novo", label: "Cadastrar lead" },
      { to: "/leads/importar", label: "Importar prospects" },
      { to: "/leads", label: "Consultar leads", end: true },
    ],
  },
];

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem("clubn.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

function Navigation({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({ campanhas: true, leads: true });
  return (
    <nav className="nav" aria-label="Menu principal">
      <NavLink to="/" end className="nav-link" onClick={onNavigate} title={collapsed ? "Visão geral" : undefined}>
        <LayoutGrid size={19} aria-hidden />
        <span className="nav-label">Visão geral</span>
      </NavLink>
      {GROUPS.map((group) => {
        const active = pathname.startsWith(`/${group.id}`);
        return (
          <div key={group.id}>
            <button
              type="button"
              className="nav-group-btn"
              aria-expanded={open[group.id]}
              aria-controls={`nav-${group.id}`}
              onClick={() => setOpen((o) => ({ ...o, [group.id]: !o[group.id] }))}
              title={collapsed ? group.label : undefined}
              style={active && !open[group.id] ? { color: "var(--text)" } : undefined}
            >
              {group.icon}
              <span className="nav-label">{group.label}</span>
              <ChevronDown size={16} className="chev" aria-hidden />
            </button>
            {open[group.id] && (
              <div className="nav-sub" id={`nav-${group.id}`}>
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className="nav-link" onClick={onNavigate}>
                    <span className="nav-label">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function Layout() {
  const { user, users, selectUser, addUser } = useSession();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [savingUser, setSavingUser] = useState(false);

  const saveUser = async () => {
    if (newName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(newEmail.trim())) {
      toast.error("Informe o nome e um e-mail válido.");
      return;
    }
    setSavingUser(true);
    try {
      const created = await addUser(newName.trim(), newEmail.trim());
      toast.success(`Operador ${created.name} adicionado e selecionado.`);
      setAdding(false);
      setNewName("");
      setNewEmail("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingUser(false);
    }
  };
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("clubn.sidebar", c ? "expanded" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="app">
      <a href="#conteudo" className="sr-only">
        Pular para o conteúdo
      </a>
      {mobileOpen && <div className="overlay" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${collapsed && !mobileOpen ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`} aria-label="Navegação">
        <div className="logo" style={{ justifyContent: "space-between" }}>
          <img src="/logo-clubn.png" alt="Club’n" width={128} height={36} />
          {mobileOpen && (
            <button className="icon-btn plain" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}>
              <X size={18} />
            </button>
          )}
        </div>
        <Navigation collapsed={collapsed && !mobileOpen} onNavigate={() => setMobileOpen(false)} />
        <div className="sidebar-footer">
          <button className="nav-group-btn" onClick={() => void logout()} style={{ fontWeight: 500 }} title={collapsed ? "Sair" : undefined}>
            <LogOut size={19} aria-hidden />
            <span className="nav-label">Sair</span>
          </button>
          <button className="nav-group-btn" onClick={toggleCollapsed} style={{ fontWeight: 500 }}>
            {collapsed ? <PanelLeftOpen size={19} aria-hidden /> : <PanelLeftClose size={19} aria-hidden />}
            <span className="nav-label">{collapsed ? "Expandir menu" : "Recolher menu"}</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="icon-btn menu-btn" aria-label="Abrir menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
              <Menu size={18} />
            </button>
            <img className="mobile-logo" src="/logo-clubn.png" alt="Club’n" width={85} height={24} />
          </div>
          <div className="topbar-right">
          <QuotaBadge />
          <div className="user-chip">
            <label htmlFor="operator" className="small muted user-name-label">
              Operador
            </label>
            <select
              id="operator"
              value={user?.id ?? ""}
              onChange={(e) => (e.target.value === "new" ? setAdding(true) : selectUser(Number(e.target.value)))}
              aria-label="Operador responsável"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              <option value="new">+ Adicionar operador</option>
            </select>
            <span className="avatar" aria-hidden>
              {initials(user?.name ?? "C N")}
            </span>
          </div>
          </div>
        </header>
        <main className="content" id="conteudo">
          <Outlet />
        </main>
        <Modal
          open={adding}
          title="Adicionar operador"
          description="Cada pessoa da equipe usa o próprio nome para que o histórico registre quem fez cada contato."
          onClose={() => setAdding(false)}
          actions={
            <>
              <button className="btn secondary" onClick={() => setAdding(false)} disabled={savingUser}>
                Cancelar
              </button>
              <button className="btn" onClick={saveUser} disabled={savingUser}>
                {savingUser ? "Salvando…" : "Adicionar"}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Nome" required htmlFor="new-user-name">
              <input id="new-user-name" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="E-mail" required htmlFor="new-user-email">
              <input id="new-user-email" className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} maxLength={120} />
            </Field>
          </div>
        </Modal>
      </div>
    </div>
  );
}
