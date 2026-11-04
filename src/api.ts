import type { Item, Kind, Draft } from "../shared/types";
export type State = Record<Kind, Item[]>;
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch("/api" + url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });
  if (!r.ok) {
    let message = r.statusText;
    try {
      message = (await r.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return r.json();
}
export function write(kind: Kind, data: Draft, id?: string) {
  return api<Item>(`/records/${kind}${id ? "/" + id : ""}`, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(data),
  });
}
export function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
