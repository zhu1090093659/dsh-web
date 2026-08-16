import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
//#region src/host/fs-service.ts
/**
* Host branch file service: workspace-gated preview/apply of node file states.
* Every target path is resolved against the workspace root and containment is
* enforced before any disk access (an escaping path rejects the whole request).
*/
function resolveInside(cwd, relative) {
	if (relative === "") return {
		code: "malformed",
		message: "empty path"
	};
	const root = resolve(cwd);
	const target = isAbsolute(relative) ? resolve(relative) : resolve(root, relative);
	if (target !== root && !target.startsWith(root + sep)) return {
		code: "path-escape",
		message: `path escapes the workspace: ${relative}`
	};
	return target;
}
async function readTextOrNull(path) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}
async function isRegularFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
function resolveTargets(root, request) {
	const targets = {};
	for (const write of request.writes) {
		const target = resolveInside(root, write.path);
		if (typeof target !== "string") return {
			ok: false,
			error: target
		};
		targets[write.path] = target;
	}
	for (const path of request.deletes) {
		const target = resolveInside(root, path);
		if (typeof target !== "string") return {
			ok: false,
			error: target
		};
		targets[path] = target;
	}
	return {
		ok: true,
		targets
	};
}
var BranchFsService = class {
	gate;
	constructor(gate) {
		this.gate = gate;
	}
	async preview(request) {
		const verdict = await this.gate(request.cwd);
		if (!verdict.ok) return {
			ok: false,
			error: verdict.error
		};
		const resolved = resolveTargets(verdict.canonical, request);
		if (!resolved.ok) return {
			ok: false,
			error: resolved.error
		};
		const entries = [];
		for (const write of request.writes) {
			const current = await readTextOrNull(resolved.targets[write.path]);
			entries.push({
				path: write.path,
				action: current === null ? "create" : "write",
				changed: current !== write.content,
				current,
				target: write.content
			});
		}
		for (const path of request.deletes) {
			const current = await readTextOrNull(resolved.targets[path]);
			entries.push({
				path,
				action: "delete",
				changed: current !== null,
				current,
				target: null
			});
		}
		return {
			ok: true,
			value: entries
		};
	}
	async apply(request) {
		const verdict = await this.gate(request.cwd);
		if (!verdict.ok) return {
			ok: false,
			error: verdict.error
		};
		const resolved = resolveTargets(verdict.canonical, request);
		if (!resolved.ok) return {
			ok: false,
			error: resolved.error
		};
		const entries = [];
		let written = 0;
		let deleted = 0;
		let failed = 0;
		for (const write of request.writes) {
			const target = resolved.targets[write.path];
			try {
				await mkdir(resolve(target, ".."), { recursive: true });
				await writeFile(target, write.content, "utf8");
				entries.push({
					path: write.path,
					action: "write",
					ok: true
				});
				written++;
			} catch (error) {
				entries.push({
					path: write.path,
					action: "write",
					ok: false,
					error: String(error)
				});
				failed++;
			}
		}
		for (const path of request.deletes) {
			const target = resolved.targets[path];
			try {
				if (await isRegularFile(target)) {
					await rm(target, { force: true });
					deleted++;
					entries.push({
						path,
						action: "delete",
						ok: true
					});
				} else entries.push({
					path,
					action: "delete",
					ok: true
				});
			} catch (error) {
				entries.push({
					path,
					action: "delete",
					ok: false,
					error: String(error)
				});
				failed++;
			}
		}
		return {
			ok: true,
			value: {
				entries,
				written,
				deleted,
				failed
			}
		};
	}
};
function isWriteTarget(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	return typeof record.path === "string" && record.path !== "" && typeof record.content === "string";
}
function isApplyRequest(value) {
	if (typeof value !== "object" || value === null) return false;
	const record = value;
	if (typeof record.cwd !== "string" || record.cwd === "") return false;
	if (!Array.isArray(record.writes) || !record.writes.every(isWriteTarget)) return false;
	if (!Array.isArray(record.deletes) || !record.deletes.every((item) => typeof item === "string" && item !== "")) return false;
	return true;
}
//#endregion
//#region src/host/routes.ts
const BODY_CAP_BYTES = 8 << 20;
const MALFORMED = {
	code: "malformed",
	message: "malformed request"
};
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
function forbidden(res) {
	res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({ error: "forbidden: loopback-only" }));
}
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const part = chunk;
		total += part.length;
		if (total > BODY_CAP_BYTES) {
			req.destroy();
			chunks.length = 0;
			return null;
		}
		chunks.push(part);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text === "") return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
function json(res, envelope, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(envelope));
}
function registerBranchRoutes(ctx, service) {
	const handler = async (req, res) => {
		if (!isLoopbackRequest(req)) {
			forbidden(res);
			return;
		}
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
			res.writeHead(415);
			res.end();
			return;
		}
		const pathname = new URL(req.url ?? "/", "http://x").pathname;
		if (pathname !== "/branch/preview" && pathname !== "/branch/apply") {
			res.writeHead(404);
			res.end();
			return;
		}
		const payload = await readJsonBody(req);
		if (!isApplyRequest(payload)) {
			json(res, {
				ok: false,
				error: MALFORMED
			});
			return;
		}
		const request = {
			cwd: payload.cwd,
			writes: [...payload.writes],
			deletes: [...payload.deletes]
		};
		json(res, pathname === "/branch/preview" ? await service.preview(request) : await service.apply(request));
	};
	const disposers = [ctx.webServer.register({
		kind: "prefix",
		path: "/branch",
		handler
	})];
	return () => {
		for (const dispose of disposers) dispose();
	};
}
//#endregion
//#region src/index.ts
/**
* @linxin666/dsh-client-ui-branch — host half: the workspace-gated file
* service and its /branch/* HTTP routes. The browser half (exports
* "./client") is served by client-modules from the same package.
*/
const inject = ["webServer", "workspaceRegistry"];
function createWorkspaceGate(ctx) {
	return async (path) => {
		let canonical;
		try {
			canonical = await realpath(path);
		} catch {
			return {
				ok: false,
				error: {
					code: "workspace-unknown",
					message: "path does not resolve on disk"
				}
			};
		}
		if (ctx.workspaceRegistry.list().some((workspace) => workspace.path === canonical)) return {
			ok: true,
			canonical
		};
		return {
			ok: false,
			error: {
				code: "workspace-unknown",
				message: "path is not a registered workspace"
			}
		};
	};
}
function apply(ctx) {
	const service = new BranchFsService(createWorkspaceGate(ctx));
	ctx.effect(() => registerBranchRoutes(ctx, service), "dsh-branch: /branch routes");
}
//#endregion
export { apply, inject };
