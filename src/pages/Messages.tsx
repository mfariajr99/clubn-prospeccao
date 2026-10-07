import { ArrowLeft, Loader2, MessageSquare, Search, SendHorizontal, Smartphone, UserRound } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { InboxConversation, InboxMessage } from "../../shared/types";
import { useSession } from "../components/Session";
import { useToast } from "../components/Toast";
import { formatPhone, useWhatsApp } from "../components/WhatsAppStatus";
import { EmptyState, SkeletonRows } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { initials } from "../lib/format";

const titleOf = (c: InboxConversation) => c.lead_name ?? c.contact_name ?? (c.phone ? formatPhone(c.phone) : "Contato");

function timeLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(today.getTime() - 86400_000);
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === new Date(today.getTime() - 86400_000).toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

/** "Mensagens": WhatsApp-like inbox of the selected operator's connected number. */
export default function Messages() {
  const { user } = useSession();
  const wa = useWhatsApp();
  const toast = useToast();
  const [conversations, setConversations] = useState<InboxConversation[] | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const loadList = useCallback(() => {
    api
      .get<{ conversations: InboxConversation[] }>("/inbox", q ? { q } : undefined)
      .then((r) => setConversations(r.conversations))
      .catch(() => setConversations((c) => c ?? []));
  }, [q]);

  const loadThread = useCallback(() => {
    if (!active) return;
    api
      .get<InboxMessage[]>("/inbox/messages", { jid: active })
      .then((m) => {
        setMessages(m);
        wa.refreshUnread();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // operator changed: start over
  useEffect(() => {
    setActive(null);
    setMessages(null);
    setConversations(null);
  }, [user?.id]);

  useEffect(() => {
    loadList();
    const t = window.setInterval(loadList, 5000);
    return () => window.clearInterval(t);
  }, [loadList, user?.id]);

  useEffect(() => {
    setMessages(null);
    stickToBottom.current = true;
    if (!active) return;
    loadThread();
    const t = window.setInterval(loadThread, 3000);
    return () => window.clearInterval(t);
  }, [active, loadThread]);

  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const current = conversations?.find((c) => c.chat_jid === active) ?? null;

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !active || sending) return;
    setSending(true);
    try {
      await api.post("/inbox/reply", { jid: active, text: body });
      setText("");
      stickToBottom.current = true;
      loadThread();
      loadList();
    } catch (err) {
      toast.error(`Mensagem não enviada: ${errorMessage(err)}`);
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  let lastDay = "";
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mensagens</h1>
          <p>
            Conversas do WhatsApp de <strong>{user?.name ?? "operador"}</strong>
            {wa.connected && wa.status?.phone ? ` (${formatPhone(wa.status.phone)})` : ""}. Responda aqui como no WhatsApp; as respostas dos leads marcam o contato como “Respondeu”.
          </p>
        </div>
      </div>

      {!wa.connected && (
        <div className="notice warning" role="note" style={{ marginBottom: 14 }}>
          <Smartphone size={16} />
          <span>
            O WhatsApp deste operador não está conectado: novas mensagens não chegam e não é possível responder. <Link to="/whatsapp">Conectar WhatsApp</Link>
          </span>
        </div>
      )}

      <div className={`inbox ${active ? "has-active" : ""}`}>
        <aside className="inbox-list" aria-label="Conversas">
          <div className="inbox-search input-with-icon">
            <Search size={16} />
            <input className="input" type="search" placeholder="Buscar conversa" aria-label="Buscar conversa" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {conversations === null ? (
            <SkeletonRows rows={6} height={56} />
          ) : conversations.length === 0 ? (
            <EmptyState icon={<MessageSquare size={26} />} title="Nenhuma conversa ainda" description="As mensagens recebidas e enviadas pelo WhatsApp conectado aparecem aqui." />
          ) : (
            <ul className="conv-items">
              {conversations.map((c) => (
                <li key={c.chat_jid}>
                  <button type="button" className={`conv ${c.chat_jid === active ? "active" : ""}`} onClick={() => setActive(c.chat_jid)} data-testid="conversation">
                    <span className="conv-avatar" aria-hidden>
                      {c.lead_name || c.contact_name ? initials(titleOf(c)) : <UserRound size={18} />}
                    </span>
                    <span className="conv-main">
                      <span className="conv-top">
                        <strong className="conv-name">{titleOf(c)}</strong>
                        <span className={`conv-time ${c.unread ? "unread" : ""}`}>{timeLabel(c.last_at)}</span>
                      </span>
                      <span className="conv-bottom">
                        <span className="conv-last">
                          {c.last_from_me ? "Você: " : ""}
                          {c.last_body}
                        </span>
                        {c.unread > 0 && <span className="conv-badge">{c.unread}</span>}
                      </span>
                      {c.lead_name && <span className="conv-tag">Lead</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="inbox-thread" aria-label="Conversa">
          {!active || !current ? (
            <div className="thread-empty">
              <MessageSquare size={34} aria-hidden />
              <p>Escolha uma conversa para ler e responder.</p>
            </div>
          ) : (
            <>
              <header className="thread-head">
                <button type="button" className="icon-btn plain thread-back" aria-label="Voltar para as conversas" onClick={() => setActive(null)}>
                  <ArrowLeft size={18} />
                </button>
                <span className="conv-avatar small" aria-hidden>
                  {initials(titleOf(current))}
                </span>
                <div style={{ minWidth: 0 }}>
                  <strong className="clamp-1">{titleOf(current)}</strong>
                  <div className="cell-sub">{current.phone ? formatPhone(current.phone) : "Número oculto pelo WhatsApp"}</div>
                </div>
                {current.lead_id && (
                  <Link to={`/leads/${current.lead_id}`} className="btn secondary xs" style={{ marginLeft: "auto" }}>
                    Ver lead
                  </Link>
                )}
              </header>
              <div
                className="thread-body"
                ref={threadRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
              >
                {messages === null ? (
                  <div className="thread-empty">
                    <Loader2 size={22} className="spin" />
                  </div>
                ) : (
                  messages.map((m) => {
                    const day = dayLabel(m.sent_at);
                    const showDay = day !== lastDay;
                    lastDay = day;
                    return (
                      <div key={m.id}>
                        {showDay && <div className="day-sep">{day}</div>}
                        <div className={`bubble ${m.from_me ? "me" : "them"}`}>
                          <span className="bubble-text">{m.body}</span>
                          <span className="bubble-time">{new Date(m.sent_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <form className="thread-compose" onSubmit={send}>
                <textarea
                  className="textarea"
                  rows={1}
                  placeholder={wa.connected ? "Digite uma mensagem" : "Conecte o WhatsApp para responder"}
                  aria-label="Mensagem"
                  value={text}
                  maxLength={4000}
                  disabled={!wa.connected || sending}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                />
                <button className="btn whatsapp send-btn" type="submit" disabled={!wa.connected || sending || !text.trim()} aria-label="Enviar">
                  {sending ? <Loader2 size={18} className="spin" /> : <SendHorizontal size={18} />}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </>
  );
}
