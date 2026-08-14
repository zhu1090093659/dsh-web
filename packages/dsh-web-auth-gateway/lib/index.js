import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer, request } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
//#region src/index.ts
const name = "web-auth-gateway";
const inject = ["webServer"];
const WEB_AUTH_GATEWAY_SETTINGS_NAMESPACE = settingsNamespace("web-auth-gateway");
const Config = z.object({
	enabled: z.boolean().default(true),
	port: z.number().step(1).min(1).max(65535).default(3090),
	sessionTtlHours: z.number().step(1).min(1).max(720).default(12)
});
const dataDir = join(homedir(), ".dsh", "web-auth-gateway");
const credentialPath = join(dataDir, "credential.json");
function loadCredential() {
	try {
		return JSON.parse(readFileSync(credentialPath, "utf8"));
	} catch {
		return;
	}
}
function saveCredential(username, password) {
	mkdirSync(dataDir, {
		recursive: true,
		mode: 448
	});
	const salt = randomBytes(16).toString("hex");
	const value = {
		username,
		salt,
		passwordHash: scryptSync(password, salt, 32).toString("hex")
	};
	const temp = `${credentialPath}.tmp`;
	writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 384 });
	renameSync(temp, credentialPath);
}
function verifyPassword(value, username, password) {
	if (username !== value.username) return false;
	const actual = scryptSync(password, value.salt, 32);
	const expected = Buffer.from(value.passwordHash, "hex");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function cookies(req) {
	const out = {};
	for (const part of (req.headers.cookie ?? "").split(";")) {
		const at = part.indexOf("=");
		if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
	}
	return out;
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 16384) req.destroy();
			else chunks.push(chunk);
		});
		req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
		req.on("error", reject);
	});
}
function loginPage(firstRun, error = "") {
	const title = firstRun ? "创建管理员账号" : "登录 DSH Web";
	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#f4f6f8;color:#182230;font:14px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(360px,calc(100vw - 48px));background:#fff;padding:32px;border:1px solid #dce2e8;border-radius:12px;box-shadow:0 12px 36px #18223018}h1{font-size:22px;margin:0 0 8px}p{color:#667085;margin:0 0 24px}label{display:block;margin:14px 0 6px}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #cbd3dc;border-radius:7px}button{width:100%;margin-top:22px;padding:11px;border:0;border-radius:7px;background:#2457d6;color:#fff;font-weight:600}.error{color:#b42318}</style></head><body><form class="card" method="post" action="/_dsh_auth/login"><h1>${title}</h1><p>${firstRun ? "首次使用，请设置至少 8 位密码。" : "验证身份后继续访问。"}</p>${error ? `<p class="error">${error}</p>` : ""}<label>用户名</label><input name="username" autocomplete="username" required value="admin"><label>密码</label><input type="password" name="password" autocomplete="current-password" minlength="8" required><button>${firstRun ? "创建并进入" : "登录"}</button></form></body></html>`;
}
function apply(ctx, config = {}) {
	let source = () => config;
	let dispose;
	const sessions = /* @__PURE__ */ new Map();
	const valid = (req) => {
		const token = cookies(req).dsh_gateway_session;
		if (!token) return false;
		const expires = sessions.get(createHash("sha256").update(token).digest("hex"));
		return expires !== void 0 && expires > Date.now();
	};
	const restart = () => {
		dispose?.();
		dispose = void 0;
		const value = source();
		if ((value.enabled ?? true) === false) return;
		const port = value.port ?? 3090;
		if (port === ctx.webServer.port) {
			ctx.logger("web-auth-gateway").error("gateway port must differ from DSH Web port");
			return;
		}
		const server = createServer(async (req, res) => {
			const path = new URL(req.url ?? "/", "http://gateway").pathname;
			if (path === "/_dsh_auth/login") {
				const credential = loadCredential();
				if (req.method === "GET") {
					res.setHeader("cache-control", "no-store");
					res.end(loginPage(credential === void 0));
					return;
				}
				if (req.method === "POST") {
					const body = await readBody(req);
					const username = body.get("username") ?? "";
					const password = body.get("password") ?? "";
					let ok = false;
					if (credential === void 0 && username.length > 0 && password.length >= 8) {
						saveCredential(username, password);
						ok = true;
					} else if (credential !== void 0) ok = verifyPassword(credential, username, password);
					if (ok) {
						const token = randomBytes(32).toString("base64url");
						const ttl = (value.sessionTtlHours ?? 12) * 36e5;
						sessions.set(createHash("sha256").update(token).digest("hex"), Date.now() + ttl);
						res.statusCode = 303;
						res.setHeader("set-cookie", `dsh_gateway_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(Math.floor(ttl / 1e3))}`);
						res.setHeader("location", "/");
						res.end();
						return;
					}
					res.statusCode = 401;
					res.end(loginPage(credential === void 0, "用户名或密码无效"));
					return;
				}
			}
			if (path === "/_dsh_auth/logout") {
				res.statusCode = 303;
				res.setHeader("set-cookie", "dsh_gateway_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
				res.setHeader("location", "/_dsh_auth/login");
				res.end();
				return;
			}
			if (!valid(req)) {
				if (path.startsWith("/api/")) {
					res.statusCode = 401;
					res.end("Unauthorized");
				} else {
					res.statusCode = 302;
					res.setHeader("location", "/_dsh_auth/login");
					res.end();
				}
				return;
			}
			proxyHttp(req, res, ctx.webServer.host, ctx.webServer.port);
		});
		server.on("upgrade", (req, socket, head) => {
			if (!valid(req)) {
				socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				return;
			}
			const upstream = connect(ctx.webServer.port, ctx.webServer.host, () => {
				const headers = {
					...req.headers,
					host: `${ctx.webServer.host}:${String(ctx.webServer.port)}`
				};
				let raw = `${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}\r\n`;
				for (const [key, item] of Object.entries(headers)) if (item !== void 0) raw += `${key}: ${Array.isArray(item) ? item.join(", ") : item}\r\n`;
				upstream.write(`${raw}\r\n`);
				if (head.length > 0) upstream.write(head);
				socket.pipe(upstream).pipe(socket);
			});
			upstream.on("error", () => socket.destroy());
		});
		server.on("error", (error) => ctx.logger("web-auth-gateway").error(error));
		server.listen(port, "127.0.0.1", () => ctx.logger("web-auth-gateway").info(`login gateway: http://127.0.0.1:${String(port)}`));
		dispose = () => server.close();
	};
	installSettingsSection(ctx, WEB_AUTH_GATEWAY_SETTINGS_NAMESPACE, Config, config, {
		setSource: (next) => {
			source = next;
		},
		onChange: restart
	});
	restart();
	ctx.effect(() => () => dispose?.(), "web-auth-gateway: server");
}
function proxyHttp(req, res, host, port) {
	const headers = {
		...req.headers,
		host: `${host}:${String(port)}`
	};
	const proxy = request({
		host,
		port,
		method: req.method,
		path: req.url,
		headers
	}, (upstream) => {
		res.writeHead(upstream.statusCode ?? 502, upstream.headers);
		upstream.pipe(res);
	});
	proxy.on("error", () => {
		if (!res.headersSent) res.writeHead(502);
		res.end("Bad Gateway");
	});
	req.pipe(proxy);
}
//#endregion
export { Config, WEB_AUTH_GATEWAY_SETTINGS_NAMESPACE, apply, inject, name };
