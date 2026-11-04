import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.resolve(
  process.env.RESEARCH_DATA_DIR || path.join(root, "data"),
);
const { app } = await createApp(directory);
const port = Number(process.env.PORT || 4317);
const { default: serveStatic } = await import("@fastify/static");
for (const folder of ["cmaps", "standard_fonts", "wasm"])
  await app.register(serveStatic, {
    root: path.join(root, "node_modules", "pdfjs-dist", folder),
    prefix: `/pdf-assets/${folder}/`,
    decorateReply: false,
  });
let closeVite: (() => Promise<void>) | undefined;
if (
  !process.argv.includes("--dev") &&
  fs.existsSync(path.join(root, "dist", "index.html"))
) {
  const { default: fastifyStatic } = await import("@fastify/static");
  await app.register(fastifyStatic, { root: path.join(root, "dist") });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/")
      ? reply.code(404).send({ error: "接口不存在" })
      : reply.sendFile("index.html"),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: { host: "127.0.0.1", port: 24678 } },
    appType: "spa",
  });
  closeVite = () => vite.close();
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/"))
      return reply.code(404).send({ error: "接口不存在" });
    reply.hijack();
    vite.middlewares(req.raw, reply.raw, () => {
      reply.raw.statusCode = 404;
      reply.raw.end("Not found");
    });
  });
}
await app.listen({ host: "127.0.0.1", port });
console.log(
  `\n  研序 · 科研工作台\n  http://127.0.0.1:${port}\n  数据目录：${directory}\n`,
);
async function shutdown() {
  await closeVite?.();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
