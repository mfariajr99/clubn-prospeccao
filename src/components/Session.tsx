import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../../shared/types";
import { api, setApiUser } from "../lib/api";

interface SessionValue {
  user: User | null;
  users: User[];
  selectUser: (id: number) => void;
  addUser: (name: string, email: string) => Promise<User>;
}

const SessionContext = createContext<SessionValue>({ user: null, users: [], selectUser: () => undefined, addUser: () => Promise.reject(new Error("no session")) });
const STORAGE_KEY = "clubn.operator";

function readStoredId(): number | null {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const stored = readStoredId();
    setApiUser(stored);
    api
      .get<User[]>("/users")
      .then((list) => {
        setUsers(list);
        const chosen = list.find((u) => u.id === stored) ?? list[0] ?? null;
        setUser(chosen);
        setApiUser(chosen?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  const selectUser = useCallback(
    (id: number) => {
      const chosen = users.find((u) => u.id === id);
      if (!chosen) return;
      setUser(chosen);
      setApiUser(id);
      try {
        window.localStorage.setItem(STORAGE_KEY, String(id));
      } catch {
        /* storage unavailable: selection lasts for this tab only */
      }
    },
    [users],
  );

  const addUser = useCallback(async (name: string, email: string) => {
    const created = await api.post<User>("/users", { name, email });
    setUsers((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    setUser(created);
    setApiUser(created.id);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(created.id));
    } catch {
      /* ignore */
    }
    return created;
  }, []);

  return <SessionContext.Provider value={{ user, users, selectUser, addUser }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
