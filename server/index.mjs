import { createApp } from "./app.mjs";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
process.umask(0o077);
const app = createApp(),
  staticDir = resolve(process.env.STATIC_DIR || "dist");
if (existsSync(resolve(staticDir, "index.html"))) {
  app.use(
    express.static(staticDir, {
      setHeaders(res, path) {
        if (
          path.includes("/assets/") ||
          path.includes("/vendor/") ||
          path.includes("/fonts/")
        )
          res.setHeader("Cache-Control", "public, max-age=86400");
      },
    }),
  );
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve(staticDir, "index.html")),
  );
}
const port = Number(process.env.PORT || 3001),
  server = app.listen(port, "0.0.0.0", () =>
    console.log(
      `Markly API listening on 0.0.0.0:${port}. Persistent SQLite storage: ${app.locals.dataDir}`,
    ),
  );
function shutdown() {
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
