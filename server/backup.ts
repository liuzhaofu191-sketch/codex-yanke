import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { kinds, type Item } from "../shared/types.ts";
import { Store } from "./db.ts";

export function backup(store: Store) {
  const records = store.list().map((i) => {
    const item = { ...i };
    delete item.apiKey;
    delete item.retryInput;
    return item;
  });
  const entries: Record<string, Uint8Array> = {
    "manifest.json": strToU8(
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        records,
        pages: store.db.prepare("SELECT * FROM pages").all(),
      }),
    ),
  };
  let total = entries["manifest.json"].length;
  for (const a of store.list("attachments")) {
    if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(a.storedName))
      throw new Error("附件路径无效");
    const file = path.join(store.directory, "files", a.storedName);
    if (!fs.existsSync(file))
      throw new Error(`附件缺失，无法创建完整备份：${a.name}`);
    if (entries["files/" + a.storedName]) continue;
    total += fs.statSync(file).size;
    if (total > 500 * 1024 * 1024)
      throw new Error(
        "ZIP 备份支持 500 MB 以内的资料；更大资料库请停止服务后复制整个 data 目录。",
      );
    entries["files/" + a.storedName] = new Uint8Array(fs.readFileSync(file));
  }
  return zipSync(entries, { level: 1 });
}
export function restore(store: Store, bytes: Uint8Array) {
  let size = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      size += file.originalSize;
      if (size > 512 * 1024 * 1024) throw new Error("备份解压大小超过 512 MB");
      return true;
    },
  });
  if (!files["manifest.json"]) throw new Error("无效的科研工作台备份");
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.records) ||
    !Array.isArray(manifest.pages)
  )
    throw new Error("不支持的备份格式");
  const records = manifest.records as Item[];
  const ids = new Set<string>();
  for (const item of records) {
    if (
      typeof item.id !== "string" ||
      ids.has(item.id) ||
      !kinds.includes(item.kind)
    )
      throw new Error("备份记录无效");
    ids.add(item.id);
    delete item.apiKey;
    delete item.retryInput;
  }
  const attachments = records.filter((i) => i.kind === "attachments");
  for (const a of attachments) {
    if (
      typeof a.storedName !== "string" ||
      !/^[a-f0-9]{64}\.[a-z0-9]+$/.test(a.storedName)
    )
      throw new Error("备份附件路径无效");
    const content = files["files/" + a.storedName];
    if (
      !content ||
      createHash("sha256").update(content).digest("hex") !== a.hash
    )
      throw new Error(`备份附件校验失败：${a.name}`);
  }
  for (const page of manifest.pages)
    if (
      !ids.has(page.attachment_id) ||
      typeof page.text !== "string" ||
      !Number.isInteger(page.page) ||
      page.page < 1
    )
      throw new Error("备份页码数据无效");
  // Hash-addressed files are immutable. Do all validation before replacing records.
  for (const a of attachments)
    fs.writeFileSync(
      path.join(store.directory, "files", a.storedName),
      files["files/" + a.storedName],
    );
  store.transaction(() => {
    store.db.exec(
      "DELETE FROM records; DELETE FROM pages; DELETE FROM search_index;",
    );
    for (const item of records) store.put(item);
    for (const p of manifest.pages)
      store.db
        .prepare("INSERT INTO pages VALUES(?,?,?,?)")
        .run(p.attachment_id, p.paper_id, p.page, p.text);
    store.reindex();
  });
  return { restored: records.length, attachments: attachments.length };
}
