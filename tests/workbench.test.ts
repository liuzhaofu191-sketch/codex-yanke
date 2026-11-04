import { samplePdf } from "./fixtures.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import { createApp } from "../server/app.ts";
import { parseBibliography, within } from "../server/imports.ts";
import { backup, restore } from "../server/backup.ts";
import { normalizeDoi } from "../shared/types.ts";
import { toPdfRect, toViewportRect } from "../shared/pdfGeometry.ts";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const testRoot = path.resolve(".cache", "tests");
fs.mkdirSync(testRoot, { recursive: true });
async function setup(t: test.TestContext, fetcher?: typeof fetch) {
  const directory = path.join(testRoot, randomUUID());
  const context = await createApp(directory, { fetcher });
  await context.app.ready();
  t.after(async () => {
    await context.app.close();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(testRoot + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { ...context, directory };
}
const create = async (app: any, kind: string, body: any) => {
  const r = await app.inject({
    method: "POST",
    url: "/api/records/" + kind,
    payload: body,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

function multipartFile(
  name: string,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
) {
  const boundary = "research-desk-test-boundary";
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields))
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}
async function waitReport(store: any, id: string) {
  for (let n = 0; n < 300; n++) {
    const r = store.get(id);
    if (r.status !== "running") return r;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("导入超时");
}

test("BibTeX preserves nested titles, creator lists and DOI; RIS supports repeated authors", () => {
  const papers = parseBibliography(
    '@string{j = "Fluid Journal"}\n@article{demo, title={A {DNS} study}, author={Doe, Jane and Smith, John}, year={2024}, journal=j, doi={https://doi.org/10.1234/ABC}, keywords={flow, DNS}}',
    ".bib",
  );
  assert.equal(papers.length, 1);
  assert.match(papers[0].title, /DNS/);
  assert.match(papers[0].authors, /Doe/);
  assert.equal(papers[0].doi, "10.1234/abc");
  const ris = parseBibliography(
    "TY  - JOUR\nTI  - 中文实验研究\nAU  - 王明\nAU  - 李华\nPY  - 2025/03\nDO  - doi:10.1234/test\nER  - \n",
    ".ris",
  );
  assert.equal(ris[0].authors, "王明; 李华");
  assert.equal(ris[0].year, "2025");
  assert.throws(() => parseBibliography("not bibtex", ".bib"));
  assert.equal(normalizeDoi("https://dx.doi.org/10.1/Test."), "10.1/test");
});
test("resource validation, local origin protection and project links", async (t) => {
  const { app, store } = await setup(t);
  const paper = await create(app, "papers", {
    title: "论文",
    status: "unread",
  });
  const note = await create(app, "notes", {
    title: "笔记",
    paperId: paper.id,
    body: "实验 reproducibility",
  });
  const project = await create(app, "projects", {
    title: "课题",
    paperIds: [paper.id],
    noteIds: [note.id],
  });
  await create(app, "tasks", {
    title: "阅读论文",
    projectId: project.id,
    status: "todo",
    priority: "high",
  });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/records/tasks",
        payload: { title: "无效关联", projectId: "missing" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/records/tools",
        payload: { title: "错误网址", url: "javascript:alert(1)" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { origin: "https://evil.test" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: "/api/state", headers: { host: "evil.test" } }))
      .statusCode,
    403,
  );
  assert.equal(store.search("实验")[0].id, note.id);
  assert.equal(store.search("reproducibility")[0].id, note.id);
  assert.equal(store.search('" OR *').length, 0);
  await app.inject({
    method: "DELETE",
    url: "/api/records/papers/" + paper.id,
  });
  assert.equal(store.get(note.id)?.paperId, null);
  assert.deepEqual(store.get(project.id)?.paperIds, []);
});
test("DOI deduplication and explicit candidate merging transfer notes and indexed pages", async (t) => {
  const { app, store, importer } = await setup(t);
  const report = importer.newReport({ title: "去重测试" });
  const first = importer.paper({ title: "Paper", doi: "10.1234/SAME" }, report);
  const dup = importer.paper(
    { title: "Updated paper", doi: "https://doi.org/10.1234/same" },
    report,
  );
  assert.equal(first.id, dup.id);
  const a = importer.paper({ title: "Same title", year: "2024" }, report);
  const b = importer.paper({ title: "Same title", year: "2024" }, report);
  assert.equal(report.candidates.length, 1);
  const attachment = await importer.attachment(samplePdf(), "test.pdf", b.id);
  const note = store.create("notes", {
    title: "合并后保留",
    paperId: b.id,
    body: "思考",
  });
  const result = await app.inject({
    method: "POST",
    url: "/api/papers/merge",
    payload: { existingId: a.id, incomingId: b.id },
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(store.get(note.id)?.paperId, a.id);
  assert.equal(store.get(attachment.item.id)?.paperId, a.id);
  assert.equal(
    store.search("reproducibility").find((h) => h.kind === "pdf")?.paperId,
    a.id,
  );
});
test("mixed batch tolerates malformed PDF and supports retry and uploaded metadata", async (t) => {
  const { app, store, directory } = await setup(t);
  const good = "note.md",
    bad = "bad.pdf";
  fs.writeFileSync(
    path.join(directory, "staging", good),
    "# 可复现研究\n\n#实验 数据质量",
  );
  fs.writeFileSync(path.join(directory, "staging", bad), "not a pdf");
  const { importer } = await Promise.resolve(app as any);
  const report = await importer.start({
    title: "混合导入",
    files: [
      { name: bad, stagedName: bad },
      { name: good, stagedName: good },
    ],
  });
  const done = await waitReport(store, report.id);
  assert.equal(done.status, "done");
  assert.equal(done.completed, 2);
  assert.equal(done.failures.length, 1);
  assert.equal(done.success, 1);
  assert.equal(store.list("papers").length, 0);
  assert.equal(store.search("可复现")[0].kind, "notes");
  const retry = await app.inject({
    method: "POST",
    url: `/api/imports/${report.id}/retry`,
  });
  assert.equal(retry.statusCode, 200, retry.body);
  const retried = await waitReport(store, retry.json().id);
  assert.equal(retried.duplicate, 1);
  const upload = await app.inject({
    method: "POST",
    url: "/api/import",
    ...multipartFile(
      "entry.bib",
      Buffer.from("@article{x,title={Uploaded research},year={2026}}"),
    ),
  });
  assert.equal(upload.statusCode, 200, upload.body);
  assert.equal((await waitReport(store, upload.json().id)).success, 1);
});
test("folder refresh updates source body while preserving own notes; missing files stay available", async (t) => {
  const { app, store, importer, directory } = await setup(t);
  const root = path.join(directory, "vault");
  fs.mkdirSync(root);
  const file = path.join(root, "Research.md");
  fs.writeFileSync(
    file,
    "---\ntitle: 研究方法\ntags: [实验, 方法]\n---\n# 实验笔记\n\n[[Related]]\n初始内容",
  );
  const source = await create(app, "sources", {
    title: "Obsidian",
    type: "obsidian",
    path: root,
  });
  let report = await importer.start({ sourceId: source.id });
  await waitReport(store, report.id);
  const note = store.list("notes")[0];
  store.update(note.id, { body: "我自己的思考，不应被覆盖" });
  fs.writeFileSync(file, "# 更新内容\n第二次来源内容");
  report = await importer.start({ sourceId: source.id });
  await waitReport(store, report.id);
  assert.equal(store.list("notes").length, 1);
  assert.equal(store.get(note.id)?.body, "我自己的思考，不应被覆盖");
  assert.match(store.get(note.id)?.sourceBody, /第二次/);
  fs.unlinkSync(file);
  report = await importer.start({ sourceId: source.id });
  await waitReport(store, report.id);
  assert.equal(store.get(note.id)?.bindings[0].missing, true);
  assert.match(store.get(note.id)?.sourceBody, /第二次/);
  assert.ok(store.get(source.id)?.lastImportedAt);
});
test("Obsidian linked files are bounded to chosen root", async (t) => {
  const { app, store, importer, directory } = await setup(t);
  const root = path.join(directory, "vault");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(directory, "outside.txt"), "secret outside");
  fs.writeFileSync(path.join(root, "inside.txt"), "safe attachment");
  fs.writeFileSync(
    path.join(root, "note.md"),
    "# 来源笔记\n[inside](inside.txt)\n[outside](../outside.txt)",
  );
  assert.equal(within(root, path.join(directory, "outside.txt")), false);
  const source = await create(app, "sources", {
    title: "Local",
    type: "folder",
    path: root,
  });
  const r = await importer.start({ sourceId: source.id });
  await waitReport(store, r.id);
  const note = store.list("notes")[0];
  assert.ok(note.linkedAttachments["inside.txt"]);
  assert.equal(note.linkedAttachments["../outside.txt"], undefined);
  assert.equal(store.list("attachments").length, 1);
});
test("PDF import is hash deduplicated, full text searchable, and range requests work", async (t) => {
  const { app, store, importer, directory } = await setup(t);
  const file = path.join(directory, "staging", "paper.pdf");
  fs.writeFileSync(file, samplePdf());
  const report = importer.newReport({ title: "PDF" });
  await importer.importFile(file, "paper.pdf", report);
  await importer.importFile(file, "paper.pdf", report);
  assert.equal(store.list("papers").length, 1);
  assert.equal(store.list("attachments").length, 1);
  assert.equal(report.duplicate, 1);
  const a = store.list("attachments")[0];
  assert.equal(a.pageCount, 2);
  assert.equal(
    store.search("reproducibility").filter((h) => h.kind === "pdf").length,
    2,
  );
  const range = await app.inject({
    url: `/api/attachments/${a.id}/file`,
    headers: { range: "bytes=0-7" },
  });
  assert.equal(range.statusCode, 206);
  assert.equal(range.rawPayload.toString(), "%PDF-1.4");
  const invalid = await app.inject({
    url: `/api/attachments/${a.id}/file`,
    headers: { range: "bytes=999999-" },
  });
  assert.equal(invalid.statusCode, 416);
  fs.renameSync(
    path.join(directory, "files", a.storedName),
    path.join(directory, "files", a.storedName + ".missing"),
  );
  assert.equal(
    (await app.inject({ url: `/api/attachments/${a.id}/file` })).statusCode,
    404,
  );
});
test("annotation geometry and reading location survive database reopen", async (t) => {
  const { app, store, importer, directory } = await setup(t);
  const p = await create(app, "papers", { title: "Geometry paper" });
  const a = (await importer.attachment(samplePdf(), "geometry.pdf", p.id)).item;
  const body = {
    paperId: p.id,
    attachmentId: a.id,
    page: 2,
    quote: "Research methods",
    rects: [[0.1, 0.8, 0.5, 0.84]],
    comment: "重要方法",
  };
  const annotation = await create(app, "annotations", body);
  assert.deepEqual(annotation.rects, body.rects);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/records/annotations",
        payload: { ...body, rects: [[0, -1, 1, 1]] },
      })
    ).statusCode,
    400,
  );
  await app.inject({
    method: "PATCH",
    url: "/api/records/papers/" + p.id,
    payload: {
      reading: { attachmentId: a.id, page: 2, rotation: 90, scale: 1.3 },
    },
  });
  const { Store } = await import("../server/db.ts");
  const reopened = new Store(directory);
  try {
    assert.equal(reopened.get(p.id)?.reading.rotation, 90);
    assert.deepEqual(reopened.get(annotation.id)?.rects, body.rects);
    assert.equal(reopened.search("重要方法")[0].id, annotation.id);
  } finally {
    reopened.close();
  }
});
test("complete backup excludes keys, preserves binary files and rejects corrupt archives atomically", async (t) => {
  const { app, store, importer } = await setup(t);
  const secret = "test-key-should-never-leak";
  const source = await create(app, "sources", {
    title: "Zotero",
    type: "zotero",
    userId: "123",
    apiKey: secret,
  });
  assert.equal(source.apiKey, undefined);
  assert.equal(source.hasKey, true);
  const p = await create(app, "papers", { title: "Backup paper" });
  const a = (await importer.attachment(samplePdf(), "backup.pdf", p.id)).item;
  const n = await create(app, "notes", {
    title: "Backup note",
    body: "备份恢复的中文内容",
    paperId: p.id,
  });
  const archive = backup(store);
  const contents = unzipSync(archive);
  assert.ok(!strFromU8(contents["manifest.json"]).includes(secret));
  assert.ok(contents["files/" + a.storedName]);
  store.remove(p.id);
  restore(store, archive);
  assert.ok(store.get(p.id));
  assert.equal(store.get(n.id)?.paperId, p.id);
  assert.equal(store.search("恢复")[0].id, n.id);
  const changed = {
    ...contents,
    ["files/" + a.storedName]: strToU8("bad hash"),
  };
  assert.throws(() => restore(store, zipSync(changed)), /校验失败/);
  assert.ok(store.get(p.id));
  const res = await app.inject({ url: "/api/state" });
  assert.ok(!res.body.includes(secret));
});
test("Zotero pagination and attachments use mock transport; refresh preserves local annotations", async (t) => {
  let calls = 0;
  const pdf = samplePdf();
  const entries = Array.from({ length: 100 }, (_, i) => ({
    key: "P" + i,
    version: 1,
    data: {
      itemType: "journalArticle",
      title: "Zotero paper " + i,
      DOI: "10.9999/p" + i,
      date: "2024",
      creators: [{ firstName: "Jane", lastName: "Doe" }],
      tags: [],
    },
  }));
  const attachment = {
    key: "A0",
    version: 1,
    data: {
      itemType: "attachment",
      parentItem: "P0",
      contentType: "application/pdf",
      filename: "zotero.pdf",
      linkMode: "imported_file",
    },
  };
  const fetcher = (async (url: any, options: any) => {
    calls++;
    assert.equal(options.headers["Zotero-API-Key"], "mock-read-key");
    if (String(url).endsWith("/file"))
      return new Response(pdf, { status: 200 });
    return Response.json(
      String(url).includes("start=100") ? [attachment] : entries,
    );
  }) as typeof fetch;
  const { app, store, importer } = await setup(t, fetcher);
  const source = await create(app, "sources", {
    title: "Mock Zotero",
    type: "zotero",
    userId: "123",
    apiKey: "mock-read-key",
  });
  let report = await importer.start({ sourceId: source.id });
  let done = await waitReport(store, report.id);
  assert.equal(done.failures.length, 0);
  assert.equal(store.list("papers").length, 100);
  assert.equal(store.list("attachments").length, 1);
  assert.equal(calls, 3);
  const note = store.create("notes", {
    title: "Independent",
    body: "My own thoughts",
    paperId: store.list("papers")[0].id,
  });
  report = await importer.start({ sourceId: source.id });
  done = await waitReport(store, report.id);
  assert.equal(done.duplicate, 101);
  assert.equal(store.get(note.id)?.body, "My own thoughts");
});
test("Zotero permission failure is visible without leaking credentials", async (t) => {
  const { app, store, importer } = await setup(
    t,
    (async () => new Response("denied", { status: 403 })) as typeof fetch,
  );
  const source = await create(app, "sources", {
    title: "Denied source",
    type: "zotero",
    userId: "123",
    apiKey: "private-key",
  });
  const r = await importer.start({ sourceId: source.id });
  const report = await waitReport(store, r.id);
  assert.equal(report.status, "failed");
  assert.match(report.failures[0].message, /403/);
  assert.ok(!JSON.stringify(report).includes("private-key"));
});
test("tool import is atomic and exports round-trip; experiment attachments are retained", async (t) => {
  const { app, store } = await setup(t);
  await create(app, "tools", {
    title: "Example tool",
    url: "https://example.org",
    category: "计算工具",
    favorite: true,
    tags: ["数值"],
  });
  const exported = await app.inject({ url: "/api/export/tools.json" });
  assert.equal(exported.statusCode, 200);
  const imported = await app.inject({
    method: "POST",
    url: "/api/tools/import",
    payload: exported.json(),
  });
  assert.equal(imported.json().imported, 1);
  const before = store.list("tools").length;
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/tools/import",
        payload: [
          { title: "valid", url: "https://example.com" },
          { title: "invalid", url: "file:///x" },
        ],
      })
    ).statusCode,
    400,
  );
  assert.equal(store.list("tools").length, before);
  const e = await create(app, "experiments", {
    title: "实验 A",
    date: "2026-11-04",
    body: "方法与结果",
  });
  const upload = await app.inject({
    method: "POST",
    url: `/api/experiments/${e.id}/attachments`,
    ...multipartFile("results.csv", Buffer.from("t,v\n0,1")),
  });
  assert.equal(upload.statusCode, 200, upload.body);
  assert.equal(upload.json().ownerId, e.id);
  assert.equal(
    (await app.inject({ url: `/api/attachments/${upload.json().id}/file` }))
      .body,
    "t,v\n0,1",
  );
});

test("PDF coordinate round trips remain accurate at every rotation and zoom level", async () => {
  const pdf = await getDocument({ data: new Uint8Array(samplePdf()) }).promise;
  try {
    const page = await pdf.getPage(1);
    const rect = [0.1, 0.82, 0.65, 0.86];
    for (const rotation of [0, 90, 180, 270])
      for (const scale of [0.4, 1, 1.3, 3]) {
        const viewport = page.getViewport({ rotation, scale });
        const [x, y, width, height] = toViewportRect(rect, page.view, viewport);
        const restored = toPdfRect(
          {
            left: x + 23,
            top: y + 45,
            right: x + width + 23,
            bottom: y + height + 45,
          },
          { left: 23, top: 45 },
          page.view,
          viewport,
        );
        restored.forEach((value, i) =>
          assert.ok(
            Math.abs(value - rect[i]) < 1e-8,
            `rotation=${rotation} scale=${scale}`,
          ),
        );
      }
  } finally {
    await pdf.destroy();
  }
});

test("Zotero file redirects do not forward private API keys to attachment storage", async (t) => {
  const fetcher = (async (url: any, options: any) => {
    if (String(url).startsWith("https://storage.example/")) {
      assert.equal(options.headers, undefined);
      return new Response(samplePdf());
    }
    if (String(url).endsWith("/file")) {
      assert.equal(options.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://storage.example/paper.pdf" },
      });
    }
    return Response.json([
      {
        key: "P",
        data: { itemType: "journalArticle", title: "Redirect paper" },
      },
      {
        key: "A",
        version: 1,
        data: {
          itemType: "attachment",
          parentItem: "P",
          filename: "redirect.pdf",
          contentType: "application/pdf",
          linkMode: "imported_file",
        },
      },
    ]);
  }) as typeof fetch;
  const { app, store, importer } = await setup(t, fetcher);
  const source = await create(app, "sources", {
    title: "Redirect source",
    type: "zotero",
    userId: "123",
    apiKey: "private-key",
  });
  const r = await importer.start({ sourceId: source.id });
  const report = await waitReport(store, r.id);
  assert.equal(report.failures.length, 0);
  assert.equal(store.list("attachments").length, 1);
});

test("HTTP backup restores imported files, notes and default statuses", async (t) => {
  const { app, store, importer } = await setup(t);
  const p = await create(app, "papers", { title: "HTTP restore" });
  assert.equal(p.status, "unread");
  const task = await create(app, "tasks", { title: "Default task" });
  assert.equal(task.status, "todo");
  await importer.attachment(samplePdf(), "restore.pdf", p.id);
  await create(app, "notes", {
    title: "Portable note",
    body: "持久化的笔记",
    paperId: p.id,
  });
  const archived = await app.inject({ url: "/api/backup" });
  assert.equal(archived.statusCode, 200, archived.body);
  store.remove(p.id);
  const restored = await app.inject({
    method: "POST",
    url: "/api/restore",
    ...multipartFile("backup.zip", archived.rawPayload),
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.ok(store.get(p.id));
  assert.equal(store.list("attachments").length, 1);
  assert.ok(store.search("持久化").length);
});
