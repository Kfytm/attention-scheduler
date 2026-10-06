#!/usr/bin/env node
/**
 * probe-assumptions.cjs —— 宿主漂移探针。
 *
 * 本技能对宿主做了若干假设（技能注册契约、指令文件通道、会话日志格式、记忆插件配置键）。
 * 宿主一旦破坏性更新，这些假设会失效。本脚本逐条检查并输出 PASS / DRIFT / SKIP，
 * 用来判断"哪些绑定点需要重写"（见 references/porting-guide.md）。
 *
 * 用法：
 *   node scripts/probe-assumptions.cjs
 *   node scripts/probe-assumptions.cjs --dsh-home <path> --runtimes <pkgRoot> --session <file> --json
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

/** 解析参数。 */
function parseArgs(argv) {
	const out = { dshHome: process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), runtimes: [], session: null, json: false, help: false };
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--dsh-home") out.dshHome = argv[++i];
		else if (arg === "--runtimes") out.runtimes.push(argv[++i]);
		else if (arg === "--session") out.session = argv[++i];
		else if (arg === "--json") out.json = true;
		else if (arg === "--help" || arg === "-h") out.help = true;
	}
	return out;
}

/** 读取文件，失败返回 undefined。 */
function readText(file) {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
}

/** 读取 JSON，失败返回 undefined。 */
function readJson(file) {
	const text = readText(file);
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** 在多个根目录里定位某个包目录。 */
function locatePackage(roots, packageName) {
	for (const root of roots) {
		const candidate = path.join(root, ...packageName.split("/"));
		if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
	}
	return undefined;
}

/** 逐帧解压 zstd。 */
function decodeFrames(file) {
	const buf = fs.readFileSync(file);
	const offsets = [];
	for (let i = 0; i + 3 < buf.length; i += 1) {
		if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i);
	}
	let text = "";
	for (const off of offsets) {
		try {
			text += zlib.zstdDecompressSync(buf.subarray(off)).toString("utf8");
		} catch {
			/* ignore */
		}
	}
	return { frames: offsets.length, text };
}

/** 找一份最近的会话日志。 */
function findSessionLog(dshHome) {
	const root = path.join(dshHome, "sessions");
	if (!fs.existsSync(root)) return undefined;
	const stack = [root];
	let best;
	while (stack.length > 0) {
		const dir = stack.pop();
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.name.endsWith(".zstd")) {
				const stat = fs.statSync(full);
				if (best === undefined || stat.mtimeMs > best.mtimeMs) best = { file: full, mtimeMs: stat.mtimeMs };
			}
		}
	}
	return best?.file;
}

const args = parseArgs(process.argv);
if (args.help) {
	console.log("用法: node scripts/probe-assumptions.cjs [--dsh-home <dir>] [--runtimes <pkgRoot>] [--session <file>] [--json]");
	process.exit(0);
}

const results = [];
const add = (group, name, status, detail) => results.push({ group, name, status, detail });

// —— 定位依赖包根目录 ——
const runtimes = [...args.runtimes];
const profilesDir = path.join(args.dshHome, "profiles");
if (fs.existsSync(profilesDir)) {
	for (const profile of fs.readdirSync(profilesDir)) runtimes.push(path.join(profilesDir, profile, "node_modules"));
}
runtimes.push(path.join(profilesDir, "node_modules"));

// 1) 宿主版本
const dshPkg = runtimes.map((root) => readJson(path.join(root, "@deepseek-ai", "dsh", "package.json"))).find(Boolean);
add("宿主", "DSH 版本", dshPkg === undefined ? "SKIP" : "PASS", dshPkg === undefined ? "未在给定根目录找到 @deepseek-ai/dsh" : `version ${dshPkg.version}`);

// 2) 技能注册契约
const skillPkgDir = locatePackage(runtimes, "@deepseek-ai/dsh-skill");
if (skillPkgDir === undefined) {
	add("技能注册", "dsh-skill 包", "SKIP", "未找到（该 provider 需要宿主自带包）");
} else {
	const skillSource = readText(path.join(skillPkgDir, "lib", "index.js")) ?? "";
	add("技能注册", "BUNDLED_SKILL_RANK 导出", skillSource.includes("BUNDLED_SKILL_RANK") ? "PASS" : "DRIFT", "lib/index.js 里查 `BUNDLED_SKILL_RANK`");
	add("技能注册", "kebab-case 技能名校验", /SKILL_NAME\s*=\s*\/\^\[a-z0-9\]/.test(skillSource) ? "PASS" : "DRIFT", "查 `SKILL_NAME` 正则");
}
const fsProviderDir = locatePackage(runtimes, "@deepseek-ai/dsh-skill-filesystem");
if (fsProviderDir !== undefined) {
	const source = readText(path.join(fsProviderDir, "lib", "index.js")) ?? "";
	add("技能注册", "registerProvider 契约", source.includes("registerProvider") ? "PASS" : "DRIFT", "dsh-skill-filesystem 里的注册调用");
	add("技能注册", "user 层 rank=400", /USER_DSH_RANK\s*=\s*400/.test(source) ? "PASS" : "DRIFT", "插件 rank 250 依赖该顺序");
}

// 3) 指令文件通道（L0 骨架）
const instrDir = locatePackage(runtimes, "@deepseek-ai/dsh-agent-instructions");
if (instrDir === undefined) {
	add("L0 骨架", "agent-instructions 包", "SKIP", "未找到");
} else {
	const source = readText(path.join(instrDir, "lib", "index.js")) ?? "";
	add("L0 骨架", "AGENTS.md / CLAUDE.md 候选", source.includes('"AGENTS.md"') ? "PASS" : "DRIFT", "查默认候选数组");
	add("L0 骨架", "maxBytes 配置键", source.includes("maxBytes") ? "PASS" : "DRIFT", "查 Config 里的 maxBytes");
	add("L0 骨架", "替换基线语义", /REPLACEMENT_AGENT_INSTRUCTIONS_INTRO/.test(source) ? "PASS" : "DRIFT", "决定「去重」结论是否成立");
	add("L0 骨架", `用户全局文件 ${path.join(args.dshHome, "AGENTS.md")}`, fs.existsSync(path.join(args.dshHome, "AGENTS.md")) ? "PASS" : "SKIP", "存在即代表 L0 已启用");
}

// 4) 会话日志格式（观测口径）
const sessionFile = args.session ?? findSessionLog(args.dshHome);
if (sessionFile === undefined) {
	add("会话日志", "找到日志", "SKIP", "未找到 *.jsonl.zstd");
} else {
	try {
		const { frames, text } = decodeFrames(sessionFile);
		add("会话日志", "多帧 zstd 可解", frames > 0 ? "PASS" : "DRIFT", `frames=${frames}`);
		add("会话日志", "request/header 字段", text.includes('"type":"request/header"') ? "PASS" : "DRIFT", "工具定义口径依赖它");
		add("会话日志", "system-prompt 来源", text.includes('"kind":"system-prompt"') ? "PASS" : "DRIFT", "系统提示口径依赖它");
		add("会话日志", "agent-instructions 来源", text.includes('"kind":"agent-instructions"') ? "PASS" : "SKIP", "未出现则本次会话无 L0");
		add("会话日志", "记忆注入来源", text.includes("plugin:memos-local-memory") ? "PASS" : "SKIP", "未出现则本次会话无 L1");
	} catch (error) {
		add("会话日志", "解析", "DRIFT", String(error.message));
	}
}

// 5) 记忆插件契约
const memosDir = locatePackage(runtimes, "@memtensor/memos-local-plugin");
if (memosDir === undefined) {
	add("记忆插件", "memos 包", "SKIP", "未安装（技能仍可用于注意力预算/写回白名单）");
} else {
	const adapter = readText(path.join(memosDir, "dist", "adapters", "deepseek-harness", "index.js")) ?? "";
	const bridge = path.join(memosDir, "dist", "adapters", "deepseek-harness", "bridge.js");
	add("记忆插件", "recallEnabled 配置键", adapter.includes("recallEnabled") ? "PASS" : "DRIFT", "L1 开关依赖它");
	add("记忆插件", "contextMaxChars 配置键", adapter.includes("contextMaxChars") ? "PASS" : "DRIFT", "L1 体积依赖它");
	add("记忆插件", "pre-step 注入路径", fs.existsSync(bridge) && (readText(bridge) ?? "").includes("pre-step") ? "PASS" : "DRIFT", "bridge.js 里的注入水落线");
}

const drifted = results.filter((item) => item.status === "DRIFT");

if (args.json) {
	console.log(JSON.stringify({ results, drifted: drifted.length }, null, 2));
} else {
	console.log("=== 宿主假设探针 ===");
	let group = "";
	for (const item of results) {
		if (item.group !== group) {
			group = item.group;
			console.log(`\n[${group}]`);
		}
		console.log(`  ${item.status.padEnd(5)} ${item.name}  ${item.detail ? "— " + item.detail : ""}`);
	}
	console.log("");
	console.log(drifted.length === 0
		? "结论：全部假设成立 ✓（无需重塑）"
		: `结论：发现 ${drifted.length} 处漂移 → 按 references/porting-guide.md 的"重塑五步"处理`);
}
