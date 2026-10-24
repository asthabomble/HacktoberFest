const BASE = import.meta.env.VITE_API_URL ?? "";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export type AppHealth = { status: "ok" | "error"; database: boolean };

export type AiHealth = {
  provider: string;
  model: string;
  ok: boolean;
  detail: string;
  generation?: string;
};
