// Thin fetch wrapper. The selected operator travels in the X-User-Id header.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get fields(): Record<string, string> {
    const d = this.details as { fields?: Record<string, string> } | undefined;
    return d?.fields ?? {};
  }
}

let currentUserId: number | null = null;
export function setApiUser(id: number | null) {
  currentUserId = id;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function toQuery(params: Query): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (currentUserId) headers["X-User-Id"] = String(currentUserId);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "Não foi possível conectar ao servidor. Verifique sua conexão.");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && (data as { code?: string }).code === "AUTH_REQUIRED") {
    window.dispatchEvent(new Event("clubn:auth-required"));
  }
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? "Erro inesperado.", (data as { details?: unknown }).details);
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>("GET", `${path}${query ? toQuery(query) : ""}`, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Erro inesperado.";
}
