export const kinds = [
  "papers",
  "attachments",
  "notes",
  "annotations",
  "sources",
  "tools",
  "projects",
  "tasks",
  "experiments",
  "settings",
  "imports",
] as const;
export type Kind = (typeof kinds)[number];
/** Resources carry different fields; discriminated by kind at the API boundary. */
export interface Item {
  id: string;
  title: string;
  kind: Kind;
  createdAt: string;
  updatedAt: string;
  [field: string]: any;
}
export type Draft = Record<string, any>;
export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  text: string;
  paperId?: string;
  attachmentId?: string;
  page?: number;
}
export interface ImportReport {
  id: string;
  status: "running" | "done" | "failed";
  total: number;
  completed: number;
  success: number;
  duplicate: number;
  failures: { name: string; message: string }[];
  candidates: { existingId: string; incomingId: string; title: string }[];
}
export function normalizeDoi(input: string): string {
  return input
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i, "")
    .replace(/[.,;]+$/, "")
    .toLowerCase();
}
export function canonicalTitle(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, "");
}
export function normalizedPoint(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return [
    Math.max(0, Math.min(1, x / width)),
    Math.max(0, Math.min(1, y / height)),
  ];
}
