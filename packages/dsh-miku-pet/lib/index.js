// src/host/index.ts
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
var name = "miku-pet";
var inject = ["webServer"];
var PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
var ROUTE_PREFIX = "/miku-pet";
var MIME = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".jsonc": "application/json; charset=utf-8"
};
function resolveAsset(root, rel) {
  if (rel.length === 0) return void 0;
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return void 0;
  return candidate;
}
function resolveExisting(root, rel) {
  const candidate = resolveAsset(root, rel);
  return candidate && existsSync(candidate) ? candidate : void 0;
}
async function sendFile(res, file, contentType, cacheControl = "public, max-age=3600") {
  const { size } = await stat(file);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": size,
    "cache-control": cacheControl
  });
  const stream = createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
var CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-cache"
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function sanitizeUserConfig(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const arr = Array.isArray(o.pets) ? o.pets : null;
  if (!arr || !arr.length) return null;
  const out = [];
  for (const p of arr) {
    if (!p || typeof p !== "object") return null;
    const pp = p;
    const id = String(pp.id ?? "");
    if (!id || id.length > 64 || /[\\/:\x00-\x1f]/.test(id)) return null;
    const size = Number(pp.size);
    if (!Number.isFinite(size) || size <= 0) return null;
    const pos = pp.position && typeof pp.position === "object" ? pp.position : {};
    const corner = String(pos.corner ?? "");
    if (!CORNERS.includes(corner)) return null;
    const marginX = Number(pos.marginX);
    const marginY = Number(pos.marginY);
    if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) return null;
    out.push({ id, size, position: { corner, marginX, marginY } });
  }
  return { pets: out };
}
function apply(ctx) {
  const thumbRoot = join(PACKAGE_ROOT, "assets", "thumb");
  const userRoot = join(resolveDshHome(), "miku-pet");
  const userConfigPath = join(userRoot, "main-config.json");
  const thumbUserRoot = join(userRoot, "main-animation");
  ctx.effect(
    () => ctx.webServer.register({
      kind: "prefix",
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));
        if (rest.startsWith("frames/")) {
          const action = rest.slice("frames/".length).split("/")[0];
          const roots = [join(thumbUserRoot, action), join(thumbRoot, action)].filter((p) => existsSync(p));
          if (!roots.length) {
            sendJson(res, 404, { error: "no such action" });
            return;
          }
          const dir = roots[0];
          const names = readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort((a, b) => {
            const ak = Number(a.match(/(\d+)(?!.*\d)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
            const bk = Number(b.match(/(\d+)(?!.*\d)/)?.[1] ?? Number.MAX_SAFE_INTEGER);
            return ak - bk;
          });
          const frames = names.map((name2) => {
            const m = name2.match(/_(\d+)_(\d+)\.png$/i);
            return { name: name2, ms: m ? parseInt(m[2], 10) || 200 : 200 };
          });
          sendJson(res, 200, { frames });
          return;
        }
        if (rest === "config") {
          if (req.method === "GET") {
            try {
              const raw = await readFile(userConfigPath, "utf8");
              sendJson(res, 200, JSON.parse(raw));
            } catch {
              sendJson(res, 200, {});
            }
            return;
          }
          if (req.method === "PUT") {
            try {
              const body = await readBody(req);
              const parsed = JSON.parse(body);
              const clean = sanitizeUserConfig(parsed);
              if (!clean) {
                sendJson(res, 400, {
                  error: "invalid pet config: expected { pets:[{id,size,position:{corner,marginX,marginY}}] }"
                });
                return;
              }
              await mkdir(userRoot, { recursive: true });
              await writeFile(userConfigPath, JSON.stringify(clean, null, 2), "utf8");
              sendJson(res, 200, { ok: true });
            } catch {
              sendJson(res, 400, { error: "invalid JSON body" });
            }
            return;
          }
          if (req.method === "DELETE") {
            try {
              await rm(userConfigPath, { force: true });
            } catch {
            }
            sendJson(res, 200, { ok: true });
            return;
          }
          sendJson(res, 405, { error: "method not allowed" });
          return;
        }
        if (rest === "config/meta") {
          sendJson(res, 200, {
            user: userConfigPath,
            default: join(PACKAGE_ROOT, "assets", "config.jsonc"),
            animations: thumbUserRoot
          });
          return;
        }
        if (rest === "config.jsonc") {
          const cfgFile = join(PACKAGE_ROOT, "assets", "config.jsonc");
          if (!existsSync(cfgFile)) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("miku-pet: config.jsonc not found");
            return;
          }
          await sendFile(res, cfgFile, MIME[".jsonc"] ?? "application/octet-stream", "no-cache");
          return;
        }
        const [scope, ...nameParts] = rest.split("/");
        if (scope !== "thumb") {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("miku-pet: expected /miku-pet/thumb/<file>");
          return;
        }
        const fileName = nameParts.join("/");
        const file = resolveExisting(thumbUserRoot, fileName) ?? resolveExisting(thumbRoot, fileName);
        if (file === void 0) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("miku-pet: asset not found");
          return;
        }
        const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
        await sendFile(res, file, MIME[ext] ?? "application/octet-stream");
      }
    }),
    "miku-pet: /miku-pet asset route"
  );
}
export {
  apply,
  inject,
  name
};
