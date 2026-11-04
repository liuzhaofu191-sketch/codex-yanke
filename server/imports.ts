import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parse as parseBibtex, initSync } from "@retorquere/bibtex-parser";
import { Store } from "./db.ts";
import {
  canonicalTitle,
  normalizeDoi,
  type Draft,
  type Item,
  type ImportReport,
} from "../shared/types.ts";
initSync({
  module: fs.readFileSync(
    fileURLToPath(
      import.meta.resolve("@retorquere/bibtex-parser/bibtex_parser_bg.wasm"),
    ),
  ),
});
const pdfAssetRoot = path.dirname(
  fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
);
const pdfOptions = {
  cMapUrl: path.join(pdfAssetRoot, "cmaps").replaceAll("\\", "/") + "/",
  cMapPacked: true,
  standardFontDataUrl: path.join(pdfAssetRoot, "standard_fonts").replaceAll("\\", "/") + "/",
  wasmUrl: path.join(pdfAssetRoot, "wasm").replaceAll("\\", "/") + "/",
};

export function parseBibliography(
  text: string,
  extension: string,
  onDiagnostic?: (message: string) => void,
): Draft[] {
  if (extension === ".bib") {
    const parsed = parseBibtex(text, { raw: true });
    if (!parsed.entries.length || (parsed.errors.length && !onDiagnostic))
      throw new Error(
        "BibTeX 解析失败：" +
          (parsed.errors.map((e) => e.error).join("；") || "未找到条目"),
      );
    for (const e of parsed.errors) onDiagnostic?.(e.error);
    return parsed.entries.map((v) => {
      const f = v.fields;
      return {
        sourceKey: v.key,
        title: f.title || v.key,
        authors: (f.author || [])
          .map(
            (a: any) =>
              a.name ||
              [a.firstName, a.prefix, a.lastName, a.suffix]
                .filter(Boolean)
                .join(" "),
          )
          .join("; "),
        year: String(f.year || f.date || "").slice(0, 4),
        journal: f.journal || f.booktitle || "",
        doi: normalizeDoi(String(f.doi || "")),
        abstract: f.abstract || "",
        tags: f.keywords || [],
        citationKey: v.key,
      };
    });
  }
  const result: Draft[] = [];
  let current: Record<string, string[]> = {};
  let last = "";
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/);
    if (m) {
      const [, key, value] = m;
      last = key;
      if (key === "ER") {
        if (Object.keys(current).length) {
          result.push({
            title: current.TI?.[0] || current.T1?.[0] || "未命名论文",
            authors: (current.AU || current.A1 || []).join("; "),
            year: (current.PY?.[0] || current.Y1?.[0] || "").slice(0, 4),
            journal: current.JO?.[0] || current.T2?.[0] || "",
            doi: normalizeDoi(current.DO?.[0] || ""),
            abstract: current.AB?.join("\n") || "",
            tags: current.KW || [],
            sourceKey: current.ID?.[0],
          });
          current = {};
        }
      } else (current[key] ||= []).push(value);
    } else if (last && current[last]?.length && line.trim())
      current[last][current[last].length - 1] += " " + line.trim();
  }
  if (!result.length)
    throw new Error("未解析到文献条目，请检查 BibTeX / RIS 格式");
  return result;
}
export function within(root: string, target: string) {
  const relative = path.relative(
    fs.realpathSync(root),
    fs.realpathSync(target),
  );
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export function listFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && within(root, full)) files.push(full);
    }
  }
  walk(root);
  return files;
}
export class Importer {
  running = new Set<string>();
  store: Store;
  fetcher: typeof fetch;
  constructor(store: Store, fetcher: typeof fetch = fetch) {
    this.store = store;
    this.fetcher = fetcher;
    for (const report of store
      .list("imports")
      .filter((r) => r.status === "running"))
      store.update(report.id, {
        status: "failed",
        failures: [
          ...(report.failures || []),
          { name: "任务中断", message: "上次运行未完成，请重试。" },
        ],
      });
  }
  newReport(input: Draft) {
    return this.store.create("imports", {
      title: input.title || "资料导入",
      status: "running",
      total: 0,
      completed: 0,
      success: 0,
      duplicate: 0,
      failures: [],
      candidates: [],
      ...input,
    });
  }
  persist(report: Item) {
    this.store.put({ ...report, updatedAt: new Date().toISOString() });
  }
  async start(input: Draft): Promise<Item> {
    const report = this.newReport({ ...input, retryInput: input });
    this.running.add(report.id);
    setTimeout(() => {
      void this.run(report, input).finally(() =>
        this.running.delete(report.id),
      );
    }, 0);
    return report;
  }
  async run(report: Item, input: Draft) {
    try {
      if (input.sourceId) {
        const source = this.store.get(input.sourceId);
        if (!source || source.kind !== "sources")
          throw new Error("资料来源不存在");
        if (source.type === "zotero") await this.zotero(source, report);
        else await this.folder(source, report);
        this.store.update(source.id, {
          lastImportedAt: new Date().toISOString(),
          lastReportId: report.id,
        });
      } else {
        report.total = input.files.length;
        this.persist(report);
        for (const file of input.files) {
          try {
            const full = path.resolve(
              this.store.directory,
              "staging",
              file.stagedName,
            );
            if (!within(path.join(this.store.directory, "staging"), full))
              throw new Error("无效导入路径");
            await this.importFile(full, file.name, report, input.paperId);
          } catch (e) {
            report.failures.push({ name: file.name, message: errorText(e) });
          }
          report.completed++;
          this.persist(report);
        }
      }
      report.status =
        report.failures.length && !report.success && !report.duplicate
          ? "failed"
          : "done";
    } catch (e) {
      report.status = "failed";
      report.failures.push({ name: report.title, message: errorText(e) });
    }
    this.persist(report);
  }
  binding(item: Item, sourceId: string, key: string) {
    const bindings = (item.bindings || []).filter(
      (b: any) => b.sourceId !== sourceId || b.key !== key,
    );
    bindings.push({
      sourceId,
      key,
      missing: false,
      lastSeen: new Date().toISOString(),
    });
    return bindings;
  }
  paper(fields: Draft, report: Item, sourceId?: string, key?: string) {
    const doi = normalizeDoi(fields.doi || "");
    let existing = sourceId
      ? this.store
          .list("papers")
          .find((p) =>
            p.bindings?.some(
              (b: any) => b.sourceId === sourceId && b.key === key,
            ),
          )
      : undefined;
    if (!existing && doi)
      existing = this.store
        .list("papers")
        .find((p) => normalizeDoi(p.doi || "") === doi);
    const incoming: Draft = { ...fields, doi };
    delete incoming.sourceKey;
    if (existing) {
      const merged: Draft = { ...incoming };
      for (const [k, v] of Object.entries(merged))
        if (v === "" || v == null) delete merged[k];
      this.store.update(existing.id, {
        ...merged,
        ...(sourceId
          ? { bindings: this.binding(existing, sourceId, key!) }
          : {}),
      });
      report.duplicate++;
      return this.store.get(existing.id)!;
    }
    const candidate = !doi
      ? this.store
          .list("papers")
          .find(
            (p) =>
              !p.doi &&
              canonicalTitle(p.title) === canonicalTitle(fields.title) &&
              String(p.year || "") === String(fields.year || ""),
          )
      : undefined;
    const item = this.store.create("papers", {
      authors: "",
      year: "",
      journal: "",
      abstract: "",
      tags: [],
      status: "unread",
      ...incoming,
      ...(sourceId
        ? {
            bindings: [
              {
                sourceId,
                key,
                missing: false,
                lastSeen: new Date().toISOString(),
              },
            ],
          }
        : {}),
    });
    if (candidate)
      report.candidates.push({
        existingId: candidate.id,
        incomingId: item.id,
        title: item.title,
      });
    report.success++;
    return item;
  }
  async attachment(
    bytes: Uint8Array,
    name: string,
    paperId?: string,
    ownerId?: string,
  ) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const ext = path.extname(name).toLowerCase();
    const existing = this.store
      .list("attachments")
      .find(
        (a) =>
          a.hash === hash && a.paperId === paperId && a.ownerId === ownerId,
      );
    if (existing) {
      const target = path.join(
        this.store.directory,
        "files",
        existing.storedName,
      );
      if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
      return { item: existing, duplicate: true };
    }
    let pages: string[] = [];
    if (ext === ".pdf") {
      const pdf = await getDocument({
        data: new Uint8Array(bytes),
        ...pdfOptions,
        useSystemFonts: true,
      }).promise;
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          pages.push(content.items.map((v: any) => v.str || "").join(" "));
        }
      } finally {
        await pdf.destroy();
      }
    }
    const storedName = hash + ext;
    const dest = path.join(this.store.directory, "files", storedName);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, bytes);
    const item = this.store.create("attachments", {
      title: name,
      name,
      hash,
      storedName,
      paperId,
      ownerId,
      mime: ext === ".pdf" ? "application/pdf" : mime(ext),
      pageCount: pages.length,
    });
    if (pages.length) this.store.setPages(item.id, paperId, pages);
    return { item, duplicate: false };
  }
  async importFile(
    full: string,
    name: string,
    report: Item,
    paperId?: string,
    source?: Item,
    root?: string,
  ) {
    const extension = path.extname(name).toLowerCase();
    const bytes = fs.readFileSync(full);
    const text = () => bytes.toString("utf8");
    const key =
      source && root
        ? path.relative(root, full).replaceAll("\\", "/")
        : undefined;
    if (extension === ".bib" || extension === ".ris") {
      const records = parseBibliography(text(), extension, (message) =>
        report.failures.push({ name, message }),
      );
      for (const [i, record] of records.entries()) {
        try {
          this.paper(
            record,
            report,
            source?.id,
            `${key}#${record.sourceKey || record.doi || i}`,
          );
        } catch (e) {
          report.failures.push({
            name: record.title || name,
            message: errorText(e),
          });
        }
      }
    } else if (extension === ".pdf") {
      let paper = paperId ? this.store.get(paperId) : undefined;
      if (paper && paper.kind !== "papers") throw new Error("目标文献不存在");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const prior = this.store
        .list("attachments")
        .find(
          (a) =>
            a.hash === hash && a.paperId && (!paperId || a.paperId === paperId),
        );
      if (prior) {
        const target = path.join(
          this.store.directory,
          "files",
          prior.storedName,
        );
        if (!fs.existsSync(target)) fs.writeFileSync(target, bytes);
        if (source) {
          const p = this.store.get(prior.paperId);
          if (p)
            this.store.update(p.id, {
              bindings: this.binding(p, source.id, key!),
            });
        }
        report.duplicate++;
        return;
      }
      if (!paper && source)
        paper = this.store
          .list("papers")
          .find((p) =>
            p.bindings?.some(
              (b: any) => b.sourceId === source.id && b.key === key,
            ),
          );
      // Validate a PDF before creating an orphan paper on malformed input.
      const pdf = await getDocument({
        data: new Uint8Array(bytes),
        ...pdfOptions,
      }).promise;
      await pdf.destroy();
      if (!paper)
        paper = this.paper(
          { title: path.basename(name, extension) },
          report,
          source?.id,
          key,
        );
      const result = await this.attachment(bytes, name, paper.id);
      if (paperId || source) {
        if (result.duplicate) report.duplicate++;
        else if (paperId) report.success++;
      }
    } else if (extension === ".md") {
      const raw = text();
      const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      const body = front ? raw.slice(front[0].length) : raw;
      const title =
        front?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ||
        body.match(/^#\s+(.+)$/m)?.[1] ||
        path.basename(name, extension);
      const tags = [
        ...new Set(
          [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)]
            .map((m) => m[1])
            .concat(
              (front?.[1].match(/^tags:\s*\[([^\]]*)\]/m)?.[1] || "")
                .split(",")
                .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
                .filter(Boolean),
            ),
        ),
      ];
      const hash = createHash("sha256").update(bytes).digest("hex");
      const prev = source
        ? this.store
            .list("notes")
            .find((n) =>
              n.bindings?.some(
                (b: any) => b.sourceId === source.id && b.key === key,
              ),
            )
        : this.store.list("notes").find((n) => n.importHash === hash);
      if (prev) {
        this.store.update(prev.id, {
          sourceBody: body,
          title,
          tags,
          ...(source ? { bindings: this.binding(prev, source.id, key!) } : {}),
        });
        report.duplicate++;
      } else {
        this.store.create("notes", {
          title,
          tags,
          body: "",
          sourceBody: body,
          importHash: hash,
          paperId,
          ...(source
            ? { bindings: [{ sourceId: source.id, key, missing: false }] }
            : {}),
        });
        report.success++;
      }
      const note =
        prev || this.store.list("notes").find((n) => n.importHash === hash);
      if (root && note) {
        const refs = [
          ...body.matchAll(
            /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!?\[[^\]]*\]\(([^)]+)\)/g,
          ),
        ].map((m) => m[1] || m[2]);
        const imported: Record<string, string> = {};
        for (const ref of refs) {
          try {
            if (/^[a-z]+:/i.test(ref) || ref.startsWith("#")) continue;
            let target = path.resolve(
              path.dirname(full),
              decodeURIComponent(ref.split("#")[0]),
            );
            if (!fs.existsSync(target))
              target =
                listFiles(root).find((f) => path.basename(f) === ref) || target;
            if (
              !fs.existsSync(target) ||
              !within(root, target) ||
              fs.statSync(target).isDirectory()
            )
              continue;
            if (
              ![
                ".pdf",
                ".png",
                ".jpg",
                ".jpeg",
                ".gif",
                ".webp",
                ".txt",
                ".csv",
              ].includes(path.extname(target).toLowerCase())
            )
              continue;
            const a = await this.attachment(
              fs.readFileSync(target),
              path.basename(target),
              undefined,
              note.id,
            );
            imported[ref] = a.item.id;
          } catch (e) {
            report.failures.push({ name: ref, message: errorText(e) });
          }
        }
        this.store.update(note.id, { linkedAttachments: imported });
      }
    } else throw new Error("支持的导入格式：PDF、BibTeX、RIS、Markdown");
  }
  async folder(source: Item, report: Item) {
    const root = fs.realpathSync(source.path);
    if (!fs.statSync(root).isDirectory())
      throw new Error("请选择有效的资料目录");
    const files = listFiles(root).filter((f) =>
      [".md", ".pdf", ".bib", ".ris"].includes(path.extname(f).toLowerCase()),
    );
    const seen = new Set(
      files.map((f) => path.relative(root, f).replaceAll("\\", "/")),
    );
    report.total = files.length;
    this.persist(report);
    for (const full of files) {
      try {
        await this.importFile(
          full,
          path.basename(full),
          report,
          undefined,
          source,
          root,
        );
      } catch (e) {
        report.failures.push({
          name: path.relative(root, full),
          message: errorText(e),
        });
      }
      report.completed++;
      this.persist(report);
    }
    for (const item of this.store
      .list()
      .filter((i) => i.bindings?.some((b: any) => b.sourceId === source.id)))
      this.store.update(item.id, {
        bindings: item.bindings.map((b: any) =>
          b.sourceId === source.id
            ? { ...b, missing: !seen.has(b.key.split("#")[0]) }
            : b,
        ),
      });
  }
  async zotero(source: Item, report: Item) {
    const secrets = readSecrets(this.store);
    const key = secrets[source.id];
    if (!key) throw new Error("请先配置 Zotero API Key");
    const headers = { "Zotero-API-Version": "3", "Zotero-API-Key": key };
    const base = `https://api.zotero.org/users/${encodeURIComponent(source.userId)}`;
    const items: any[] = [];
    for (let start = 0; ; start += 100) {
      const response = await this.fetcher(
        `${base}/items?limit=100&start=${start}&format=json`,
        { headers, signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok)
        throw new Error(
          `Zotero 请求失败（HTTP ${response.status}），请检查用户 ID、只读权限及网络`,
        );
      const batch = (await response.json()) as any[];
      items.push(...batch);
      if (batch.length < 100) break;
    }
    const papers = items.filter(
      (i) => !["attachment", "note", "annotation"].includes(i.data.itemType),
    );
    const attachments = items.filter((i) => i.data.itemType === "attachment");
    report.total = papers.length + attachments.length;
    this.persist(report);
    const seen = new Set<string>();
    const parentIds = new Map<string, string>();
    for (const i of papers) {
      try {
        const d = i.data;
        const p = this.paper(
          {
            title: d.title || "未命名论文",
            authors: (d.creators || [])
              .map(
                (a: any) =>
                  a.name || [a.firstName, a.lastName].filter(Boolean).join(" "),
              )
              .join("; "),
            year: d.date?.match(/\d{4}/)?.[0] || "",
            journal: d.publicationTitle || "",
            doi: d.DOI || "",
            abstract: d.abstractNote || "",
            tags: (d.tags || []).map((t: any) => t.tag),
          },
          report,
          source.id,
          i.key,
        );
        parentIds.set(i.key, p.id);
        seen.add(i.key);
      } catch (e) {
        report.failures.push({ name: i.key, message: errorText(e) });
      }
      report.completed++;
      this.persist(report);
    }
    for (const i of attachments) {
      try {
        const d = i.data;
        const paperId = parentIds.get(d.parentItem);
        if (paperId && d.contentType === "application/pdf") {
          if (d.linkMode === "linked_file" || d.linkMode === "linked_url")
            throw new Error("此附件为本地链接或网址，请通过本地 PDF 导入");
          const prior = this.store
            .list("attachments")
            .find(
              (a) =>
                a.zoteroKey === i.key &&
                a.sourceId === source.id &&
                a.sourceVersion === i.version,
            );
          if (prior) report.duplicate++;
          else {
            let r = await this.fetcher(
              `${base}/items/${encodeURIComponent(i.key)}/file`,
              {
                headers,
                redirect: "manual",
                signal: AbortSignal.timeout(60000),
              },
            );
            if ([301, 302, 303, 307, 308].includes(r.status)) {
              const target = r.headers.get("location");
              if (!target || new URL(target).protocol !== "https:")
                throw new Error("附件下载地址无效");
              r = await this.fetcher(target, {
                signal: AbortSignal.timeout(60000),
              });
            }
            if (!r.ok)
              throw new Error(
                `附件下载失败（HTTP ${r.status}），可改为手动导入 PDF`,
              );
            const a = await this.attachment(
              new Uint8Array(await r.arrayBuffer()),
              d.filename || "论文.pdf",
              paperId,
            );
            this.store.update(a.item.id, {
              sourceId: source.id,
              zoteroKey: i.key,
              sourceVersion: i.version,
            });
            report.success++;
          }
        }
      } catch (e) {
        report.failures.push({
          name: i.data.filename || i.key,
          message: errorText(e),
        });
      }
      report.completed++;
      this.persist(report);
    }
    const fetchedKeys = new Set(papers.map((i) => i.key));
    for (const p of this.store.list("papers"))
      if (p.bindings?.some((b: any) => b.sourceId === source.id))
        this.store.update(p.id, {
          bindings: p.bindings.map((b: any) =>
            b.sourceId === source.id
              ? { ...b, missing: !fetchedKeys.has(b.key) }
              : b,
          ),
        });
  }
}
export function errorText(e: unknown) {
  return e instanceof Error ? e.message : "操作失败";
}
export function readSecrets(store: Store): Record<string, string> {
  const file = path.join(store.directory, "secrets.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
export function saveSecret(store: Store, id: string, key: string) {
  const secrets = readSecrets(store);
  if (key) secrets[id] = key;
  else delete secrets[id];
  fs.writeFileSync(
    path.join(store.directory, "secrets.json"),
    JSON.stringify(secrets),
    { mode: 0o600 },
  );
}
function mime(ext: string) {
  return (
    (
      {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".txt": "text/plain",
        ".csv": "text/csv",
      } as Record<string, string>
    )[ext] || "application/octet-stream"
  );
}
