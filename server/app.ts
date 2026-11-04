import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Store } from "./db.ts";
import {
  Importer,
  readSecrets,
  saveSecret,
  parseBibliography,
  errorText,
} from "./imports.ts";
import { backup, restore } from "./backup.ts";
import {
  kinds,
  normalizeDoi,
  type Kind,
  type Draft,
  type Item,
} from "../shared/types.ts";

export async function createApp(
  directory: string,
  options: { fetcher?: typeof fetch } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  const store = new Store(directory);
  const importer = new Importer(store, options.fetcher);
  app.decorate("store", store);
  app.decorate("importer", importer);
  await app.register(multipart, {
    limits: { fileSize: 256 * 1024 * 1024, files: 100 },
  });
  app.addHook("onClose", async () => store.close());
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api")) {
      if (!["127.0.0.1", "localhost"].includes(req.hostname))
        return reply.code(403).send({ error: "仅允许本机访问" });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`)
        return reply.code(403).send({ error: "不允许跨站访问本地数据" });
      reply.header("Cache-Control", "no-store");
    }
  });
  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number };
    reply.code(e.statusCode || 400).send({ error: errorText(e) });
  });
  const resource = (kind: string): Kind => {
    if (!kinds.includes(kind as Kind)) throw new Error("未知资源");
    return kind as Kind;
  };
  const requireItem = (kind: Kind, id: string) => {
    const i = store.get(id);
    if (!i || i.kind !== kind) throw new Error("记录不存在");
    return i;
  };
  function validate(kind: Kind, data: Draft, previous?: Item) {
    const item = { ...previous, ...data };
    if (["papers", "notes", "tools"].includes(kind)) item.tags ??= [];
    if (kind === "papers") item.status ||= "unread";
    if (kind === "projects") item.status ||= "doing";
    if (kind === "tasks") {
      item.status ||= "todo";
      item.priority ||= "normal";
    }
    if (["notes", "experiments"].includes(kind)) item.body ??= "";
    if (
      [
        "papers",
        "notes",
        "tools",
        "projects",
        "tasks",
        "experiments",
        "sources",
      ].includes(kind) &&
      (!item.title || typeof item.title !== "string" || !item.title.trim())
    )
      throw new Error("标题不能为空");
    if (kind === "papers") {
      if (item.doi) item.doi = normalizeDoi(item.doi);
      if (item.status && !["unread", "reading", "done"].includes(item.status))
        throw new Error("阅读状态无效");
    }
    if (kind === "papers" && item.reading) {
      const r = item.reading;
      const a = requireItem("attachments", r.attachmentId);
      if (
        a.paperId !== previous?.id ||
        !Number.isInteger(r.page) ||
        r.page < 1 ||
        r.page > a.pageCount ||
        ![0, 90, 180, 270].includes(r.rotation) ||
        typeof r.scale !== "number" ||
        r.scale < 0.4 ||
        r.scale > 3
      )
        throw new Error("阅读位置无效");
    }
    if (kind === "tools" && !/^https?:\/\//i.test(item.url || ""))
      throw new Error("工具网址必须以 http:// 或 https:// 开头");
    if (kind === "tasks") {
      if (!["todo", "doing", "done"].includes(item.status || "todo"))
        throw new Error("任务状态无效");
      if (!["low", "normal", "high"].includes(item.priority))
        throw new Error("任务优先级无效");
      if (item.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate))
        throw new Error("截止日期格式无效");
    }
    for (const [key, target] of Object.entries({
      paperId: "papers",
      attachmentId: "attachments",
      projectId: "projects",
    }))
      if (item[key]) requireItem(target as Kind, item[key]);
    for (const [key, target] of Object.entries({
      paperIds: "papers",
      noteIds: "notes",
      projectIds: "projects",
      toolIds: "tools",
    }))
      if (item[key]) {
        if (!Array.isArray(item[key])) throw new Error("关联字段必须是数组");
        for (const id of item[key]) requireItem(target as Kind, id);
      }
    if (
      item.tags &&
      (!Array.isArray(item.tags) ||
        item.tags.some((tag: unknown) => typeof tag !== "string"))
    )
      throw new Error("标签必须是文本数组");
    if (kind === "annotations") {
      const a = requireItem("attachments", item.attachmentId);
      if (
        !Number.isInteger(item.page) ||
        item.page < 1 ||
        item.page > a.pageCount
      )
        throw new Error("批注页码无效");
      if (item.paperId !== a.paperId) throw new Error("批注与附件不匹配");
      if (
        !Array.isArray(item.rects) ||
        item.rects.some(
          (r: any) =>
            !Array.isArray(r) ||
            r.length !== 4 ||
            r.some(
              (v: any) =>
                typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1,
            ),
        )
      )
        throw new Error("批注坐标无效");
    }
    if (kind === "sources") {
      if (!["folder", "obsidian", "zotero"].includes(item.type))
        throw new Error("来源类型无效");
      if (item.type === "zotero") {
        if (!/^\d+$/.test(item.userId || ""))
          throw new Error("Zotero 用户 ID 必须为数字");
      } else {
        if (!path.isAbsolute(item.path || ""))
          throw new Error("请输入本地目录的完整路径");
        const real = fs.realpathSync(item.path);
        if (!fs.statSync(real).isDirectory()) throw new Error("请选择目录");
        item.path = real;
      }
    }
    if (kind === "settings" && item.searchEngines)
      for (const e of item.searchEngines) {
        if (!/^https?:\/\//.test(e.url) || !e.url.includes("{query}"))
          throw new Error("检索网址需为 HTTP(S) 并包含 {query}");
      }
    delete item.apiKey;
    return item;
  }
  function publicItem(item: Item) {
    return item.kind === "sources"
      ? { ...item, hasKey: !!readSecrets(store)[item.id] }
      : item;
  }
  app.get("/api/health", async () => ({ ok: true, version: 1 }));
  app.get("/api/state", async () =>
    Object.fromEntries(kinds.map((k) => [k, store.list(k).map(publicItem)])),
  );
  app.get<{ Params: { kind: string } }>("/api/records/:kind", async (req) =>
    store.list(resource(req.params.kind)).map(publicItem),
  );
  app.post<{ Params: { kind: string }; Body: Draft }>(
    "/api/records/:kind",
    async (req, reply) => {
      const kind = resource(req.params.kind);
      if (["attachments", "imports"].includes(kind))
        throw new Error("请通过导入接口创建");
      const body = validate(kind, req.body);
      const item = store.create(kind, body);
      if (kind === "sources" && req.body.apiKey)
        saveSecret(store, item.id, String(req.body.apiKey));
      return reply.code(201).send(publicItem(item));
    },
  );
  app.patch<{ Params: { kind: string; id: string }; Body: Draft }>(
    "/api/records/:kind/:id",
    async (req) => {
      const kind = resource(req.params.kind);
      if (["attachments", "imports"].includes(kind))
        throw new Error("此资源由系统维护");
      const previous = requireItem(kind, req.params.id);
      const data = validate(kind, req.body, previous);
      const updated = store.update(previous.id, data);
      if (kind === "sources" && req.body.apiKey !== undefined)
        saveSecret(store, updated.id, String(req.body.apiKey));
      return publicItem(updated);
    },
  );
  app.delete<{ Params: { kind: string; id: string } }>(
    "/api/records/:kind/:id",
    async (req) => {
      const kind = resource(req.params.kind);
      const item = requireItem(kind, req.params.id);
      if (importer.running.size && ["sources", "papers"].includes(kind))
        throw new Error("请等待当前导入完成后再删除");
      store.remove(item.id);
      if (kind === "sources") saveSecret(store, item.id, "");
      return { ok: true };
    },
  );
  app.get<{ Querystring: { q: string } }>("/api/search", async (req) =>
    store.search(req.query.q || ""),
  );
  app.post("/api/import", async (req) => {
    const files: { stagedName: string; name: string }[] = [];
    let paperId: string | undefined;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const name = path.basename(part.filename);
        const ext = path.extname(name).toLowerCase();
        const stagedName = randomUUID() + ext;
        const dest = path.join(directory, "staging", stagedName);
        await pipeline(part.file, fs.createWriteStream(dest));
        if (part.file.truncated) {
          fs.unlinkSync(dest);
          throw new Error("单文件不能超过 256 MB");
        }
        files.push({ stagedName, name });
      } else if (part.fieldname === "paperId") paperId = String(part.value);
    }
    if (!files.length) throw new Error("请选择导入文件");
    if (paperId) requireItem("papers", paperId);
    return importer.start({ title: "文件导入", files, paperId });
  });
  app.post<{ Params: { id: string } }>(
    "/api/sources/:id/refresh",
    async (req) => {
      const source = requireItem("sources", req.params.id);
      if (
        store
          .list("imports")
          .some((r) => r.status === "running" && r.sourceId === source.id)
      )
        throw new Error("此来源正在刷新");
      return importer.start({ title: source.title, sourceId: source.id });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/imports/:id/retry",
    async (req) => {
      const report = requireItem("imports", req.params.id);
      if (!report.retryInput)
        throw new Error("此记录来自备份，请重新选择文件或刷新来源");
      if (report.status === "running") throw new Error("导入仍在进行");
      return importer.start(report.retryInput);
    },
  );
  app.post<{ Body: { existingId: string; incomingId: string } }>(
    "/api/papers/merge",
    async (req) => {
      const { existingId, incomingId } = req.body;
      if (existingId === incomingId) throw new Error("不能合并同一条记录");
      const target = requireItem("papers", existingId),
        incoming = requireItem("papers", incomingId);
      store.transaction(() => {
        for (const item of store.list()) {
          if (item.paperId === incomingId)
            store.update(item.id, { paperId: existingId });
          if (item.paperIds?.includes(incomingId))
            store.update(item.id, {
              paperIds: [
                ...new Set(
                  item.paperIds.map((v: string) =>
                    v === incomingId ? existingId : v,
                  ),
                ),
              ],
            });
        }
        store.db
          .prepare("UPDATE pages SET paper_id=? WHERE paper_id=?")
          .run(existingId, incomingId);
        store.update(existingId, {
          bindings: [...(target.bindings || []), ...(incoming.bindings || [])],
          tags: [
            ...new Set([...(target.tags || []), ...(incoming.tags || [])]),
          ],
        });
        store.remove(incomingId);
        store.reindex();
      });
      return store.get(existingId);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/attachments/:id/file",
    async (req, reply) => {
      const a = requireItem("attachments", req.params.id);
      if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(a.storedName))
        throw new Error("无效附件路径");
      const full = path.join(directory, "files", a.storedName);
      if (!fs.existsSync(full))
        return reply
          .code(404)
          .send({ error: "附件文件缺失，请从来源重新导入或恢复备份" });
      const size = fs.statSync(full).size;
      reply
        .type(a.mime || "application/octet-stream")
        .header("Accept-Ranges", "bytes")
        .header("X-Content-Type-Options", "nosniff");
      if (req.headers.range) {
        const m = req.headers.range.match(/^bytes=(\d+)-(\d*)$/);
        if (!m)
          return reply
            .code(416)
            .header("Content-Range", `bytes */${size}`)
            .send();
        const start = Number(m[1]),
          end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end || start >= size)
          return reply
            .code(416)
            .header("Content-Range", `bytes */${size}`)
            .send();
        return reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${size}`)
          .header("Content-Length", end - start + 1)
          .send(fs.createReadStream(full, { start, end }));
      }
      return reply
        .header("Content-Length", size)
        .send(fs.createReadStream(full));
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/experiments/:id/attachments",
    async (req) => {
      const exp = requireItem("experiments", req.params.id);
      const part = await req.file();
      if (!part) throw new Error("请选择附件");
      const ext = path.extname(part.filename).toLowerCase();
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
          ".json",
          ".zip",
        ].includes(ext)
      )
        throw new Error("支持 PDF、图片、文本、CSV、JSON 和 ZIP");
      const bytes = await part.toBuffer();
      return (
        await importer.attachment(
          bytes,
          path.basename(part.filename),
          undefined,
          exp.id,
        )
      ).item;
    },
  );
  app.post<{ Body: { text: string; format: string } }>(
    "/api/utilities/bibtex",
    async (req) =>
      parseBibliography(
        req.body.text,
        req.body.format === ".ris" ? ".ris" : ".bib",
      ),
  );
  app.get("/api/backup", async (req, reply) => {
    if (importer.running.size) throw new Error("请等待导入完成再备份");
    return reply
      .type("application/zip")
      .header(
        "Content-Disposition",
        'attachment; filename="research-desk-backup.zip"',
      )
      .send(Buffer.from(backup(store)));
  });
  app.post("/api/restore", async (req) => {
    if (importer.running.size) throw new Error("请等待导入完成再恢复");
    const file = await req.file({ limits: { fileSize: 512 * 1024 * 1024 } });
    if (!file) throw new Error("请选择备份文件");
    return restore(store, await file.toBuffer());
  });
  app.get<{ Params: { format: string } }>(
    "/api/export/:format",
    async (req, reply) => {
      const format = req.params.format;
      let text = "",
        type = "text/plain; charset=utf-8";
      if (format === "tools.json") {
        text = JSON.stringify(
          store
            .list("tools")
            .map(({ id, kind, createdAt, updatedAt, ...data }) => data),
          null,
          2,
        );
        type = "application/json";
      } else if (format === "papers.bib")
        text = store
          .list("papers")
          .map(
            (p, i) =>
              `@article{${p.citationKey || "paper" + (i + 1)},\n${[
                "title",
                "author",
                "year",
                "journal",
                "doi",
              ]
                .map(
                  (k) =>
                    `  ${k} = {${String(p[k === "author" ? "authors" : k] || "")
                      .replace(/[{}]/g, "")
                      .replace(/;/g, k === "author" ? " and" : ";")}}`,
                )
                .join(",\n")}\n}`,
          )
          .join("\n\n");
      else if (format === "notes.md")
        text = store
          .list("notes")
          .map(
            (n) => `# ${n.title}\n\n${n.sourceBody || ""}\n\n${n.body || ""}`,
          )
          .join("\n\n---\n\n");
      else throw new Error("导出格式无效");
      return reply
        .type(type)
        .header("Content-Disposition", `attachment; filename="${format}"`)
        .send(text);
    },
  );
  app.post<{ Body: Draft[] }>("/api/tools/import", async (req) => {
    if (!Array.isArray(req.body)) throw new Error("请选择工具列表 JSON 数组");
    const prepared = req.body.map((t) => validate("tools", t));
    store.transaction(() => {
      for (const t of prepared) store.create("tools", t);
    });
    return { imported: prepared.length };
  });
  return { app, store, importer };
}
