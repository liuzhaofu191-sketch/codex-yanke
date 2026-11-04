import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  kinds,
  type Kind,
  type Item,
  type Draft,
  type SearchHit,
} from "../shared/types.ts";

export class Store {
  db: DatabaseSync;
  directory: string;
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    mkdirSync(path.join(directory, "files"), { recursive: true });
    mkdirSync(path.join(directory, "staging"), { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "research.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
      CREATE TABLE IF NOT EXISTS pages(attachment_id TEXT NOT NULL, paper_id TEXT, page INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(attachment_id,page));
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(id UNINDEXED, kind UNINDEXED, title, text, paper_id UNINDEXED, attachment_id UNINDEXED, page UNINDEXED, tokenize='trigram');
      INSERT OR IGNORE INTO migrations VALUES(1, datetime('now'));`);
    if (!this.list("settings").length)
      this.create("settings", {
        title: "偏好设置",
        searchEngines: [
          {
            name: "Google Scholar",
            url: "https://scholar.google.com/scholar?q={query}",
          },
          {
            name: "arXiv",
            url: "https://arxiv.org/search/?query={query}&searchtype=all",
          },
          {
            name: "Semantic Scholar",
            url: "https://www.semanticscholar.org/search?q={query}",
          },
        ],
      });
    this.reindex();
  }
  list(kind?: Kind): Item[] {
    return (
      kind
        ? this.db.prepare("SELECT data FROM records WHERE kind=?").all(kind)
        : this.db.prepare("SELECT data FROM records").all()
    ).map((r) => JSON.parse(String(r.data)));
  }
  get(id: string): Item | undefined {
    const r = this.db.prepare("SELECT data FROM records WHERE id=?").get(id);
    return r ? JSON.parse(String(r.data)) : undefined;
  }
  create(kind: Kind, data: Draft): Item {
    if (!kinds.includes(kind)) throw new Error("未知资源类型");
    const now = new Date().toISOString();
    const item = {
      title: data.title || data.quote || "未命名",
      ...data,
      id: randomUUID(),
      kind,
      createdAt: now,
      updatedAt: now,
    };
    this.put(item);
    return item;
  }
  put(item: Item) {
    this.db
      .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)")
      .run(item.id, item.kind, JSON.stringify(item));
    this.indexItem(item);
  }
  update(id: string, data: Draft) {
    const prev = this.get(id);
    if (!prev) throw new Error("记录不存在");
    const item = {
      ...prev,
      ...data,
      id: prev.id,
      kind: prev.kind,
      createdAt: prev.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.put(item);
    return item;
  }
  remove(id: string) {
    const item = this.get(id);
    if (!item) return;
    // Delete only application records; imported source files are never removed.
    if (item.kind === "papers") {
      for (const row of this.list()) {
        if (row.paperId === id) {
          if (row.kind === "notes") this.update(row.id, { paperId: null });
          else this.remove(row.id);
        } else if (row.paperIds?.includes(id))
          this.update(row.id, {
            paperIds: row.paperIds.filter((v: string) => v !== id),
          });
      }
    }
    if (item.kind === "attachments") {
      this.db.prepare("DELETE FROM pages WHERE attachment_id=?").run(id);
      this.db.prepare("DELETE FROM search_index WHERE attachment_id=?").run(id);
      for (const a of this.list("annotations").filter(
        (a) => a.attachmentId === id,
      ))
        this.remove(a.id);
      const paper = this.get(item.paperId || "");
      if (paper?.reading?.attachmentId === id)
        this.update(paper.id, { reading: null });
    }
    if (item.kind === "projects")
      for (const row of this.list()) {
        if (row.projectId === id) this.update(row.id, { projectId: null });
        if (row.projectIds?.includes(id))
          this.update(row.id, {
            projectIds: row.projectIds.filter((v: string) => v !== id),
          });
      }
    if (item.kind === "tools")
      for (const row of this.list("projects"))
        if (row.toolIds?.includes(id))
          this.update(row.id, {
            toolIds: row.toolIds.filter((v: string) => v !== id),
          });
    if (item.kind === "notes")
      for (const row of this.list("projects"))
        if (row.noteIds?.includes(id))
          this.update(row.id, {
            noteIds: row.noteIds.filter((v: string) => v !== id),
          });
    if (["notes", "experiments"].includes(item.kind))
      for (const a of this.list("attachments").filter((a) => a.ownerId === id))
        this.remove(a.id);
    this.db.prepare("DELETE FROM records WHERE id=?").run(id);
    this.db.prepare("DELETE FROM search_index WHERE id=?").run(id);
  }
  indexItem(item: Item) {
    this.db.prepare("DELETE FROM search_index WHERE id=?").run(item.id);
    if (
      ![
        "papers",
        "notes",
        "annotations",
        "experiments",
        "projects",
        "tools",
        "tasks",
      ].includes(item.kind)
    )
      return;
    const text = [
      item.authors,
      item.abstract,
      item.doi,
      item.journal,
      item.tags?.join(" "),
      item.sourceBody,
      item.body,
      item.quote,
      item.comment,
      item.description,
    ]
      .filter(Boolean)
      .join("\n");
    this.db
      .prepare("INSERT INTO search_index VALUES(?,?,?,?,?,?,?)")
      .run(
        item.id,
        item.kind,
        item.title || item.quote || "未命名",
        text,
        item.paperId || (item.kind === "papers" ? item.id : null),
        item.attachmentId || null,
        item.page || null,
      );
  }
  setPages(attachmentId: string, paperId: string | undefined, pages: string[]) {
    this.db
      .prepare("DELETE FROM pages WHERE attachment_id=?")
      .run(attachmentId);
    this.db
      .prepare("DELETE FROM search_index WHERE attachment_id=? AND kind='pdf'")
      .run(attachmentId);
    pages.forEach((text, i) => {
      this.db
        .prepare("INSERT INTO pages VALUES(?,?,?,?)")
        .run(attachmentId, paperId || null, i + 1, text);
      this.db
        .prepare("INSERT INTO search_index VALUES(?,?,?,?,?,?,?)")
        .run(
          `${attachmentId}:${i + 1}`,
          "pdf",
          this.get(paperId || "")?.title || "PDF 正文",
          text,
          paperId || null,
          attachmentId,
          i + 1,
        );
    });
  }
  reindex() {
    this.db.exec("DELETE FROM search_index");
    for (const i of this.list()) this.indexItem(i);
    for (const p of this.db.prepare("SELECT * FROM pages").all())
      this.db
        .prepare("INSERT INTO search_index VALUES(?,?,?,?,?,?,?)")
        .run(
          `${p.attachment_id}:${p.page}`,
          "pdf",
          this.get(String(p.paper_id))?.title || "PDF 正文",
          p.text,
          p.paper_id,
          p.attachment_id,
          p.page,
        );
  }
  search(q: string): SearchHit[] {
    const term = q.trim();
    if (!term) return [];
    const columns = "id,kind,title,text,paper_id,attachment_id,page";
    const rows =
      [...term].length < 3
        ? this.db
            .prepare(
              `SELECT ${columns} FROM search_index WHERE instr(lower(title||' '||text),lower(?))>0 LIMIT 100`,
            )
            .all(term)
        : this.db
            .prepare(
              `SELECT ${columns} FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 100`,
            )
            .all('"' + term.replaceAll('"', '""') + '"');
    return rows.map((r) => {
      const text = String(r.text);
      const pos = text.toLowerCase().indexOf(term.toLowerCase());
      return {
        id: String(r.id),
        kind: String(r.kind),
        title: String(r.title),
        text: text.slice(Math.max(0, pos - 45), Math.max(0, pos - 45) + 220),
        paperId: r.paper_id ? String(r.paper_id) : undefined,
        attachmentId: r.attachment_id ? String(r.attachment_id) : undefined,
        page: r.page ? Number(r.page) : undefined,
      };
    });
  }
  transaction(fn: () => void) {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
