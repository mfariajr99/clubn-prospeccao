import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Registro") => new HttpError(404, `${what} não encontrado.`);

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, "Dados inválidos.", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return result.data;
}

export function intParam(value: unknown, name = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Parâmetro ${name} inválido.`);
  return n;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Dados inválidos.", details: err.issues });
    return;
  }
  const status = (err as { status?: number; type?: string })?.status;
  if (status === 413) {
    res.status(413).json({ error: "Arquivo ou conteúdo muito grande." });
    return;
  }
  if (status === 400) {
    res.status(400).json({ error: "Requisição inválida." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Erro interno. Tente novamente." });
}
