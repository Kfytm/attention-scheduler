/**
 * dsh-attention-scheduler —— 把「注意力调度与记忆检索规则」作为**运行期技能**内嵌分发。
 *
 * 设计：
 * 1. 零外部依赖（只用 node: 内置模块），避免 profile 依赖解析问题；
 * 2. 通过 `ctx.skills.registerProvider()` 注册一个只读 provider（官方 dsh-skill-office 同款写法）；
 * 3. 技能正文来自仓库根目录的 `SKILL.md`（也支持 `skills/<name>/SKILL.md` 多技能形态）；
 * 4. `resourceBase` 指向技能所在目录，因此技能正文里引用的 `references/`、`scripts/` 都可被读取；
 * 5. rank = 250：低于 user(400) 与 bundled(600)，因此**用户本地的同名文件技能可以覆盖它**；
 * 6. 监听 SKILL.md 变化并 `control.invalidate()`，改完正文无需重启宿主。
 *
 * DSH 技能 rank 体系（dsh-skill / dsh-skill-filesystem）：
 * project-dsh 100 < project-agents 200 < runtime 250 < custom 300 < user-dsh 400 < user-agents 500 < bundled 600
 */
import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 插件根目录（本文件位于 <root>/lib/）。 */
const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
/** 技能来源标识。 */
const PROVIDER_NAME = "dsh-attention-scheduler";
/** 技能排序权重；低于用户层，便于本地覆盖。 */
const PLUGIN_SKILL_RANK = 250;
/** 合法技能名（kebab-case）。 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Cordis 插件标识。 */
export const name = "attention-scheduler";
/** 依赖：技能注册表。 */
export const inject = ["skills"];

/**
 * 读取 frontmatter 里的单行标量。
 * @param front - frontmatter 原文（不含 ---）。
 * @param key - 字段名。
 * @returns 去引号后的值，缺失时为 undefined。
 */
function readScalar(front, key) {
	const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(front);
	if (match === null) return undefined;
	const value = match[1].trim().replace(/^["']|["']$/g, "");
	return value === "" ? undefined : value;
}

/**
 * 读取 description：支持单行、`|` 与 `>` 块标量。
 * @param front - frontmatter 原文。
 * @returns 描述文本，缺失时为 undefined。
 */
function readDescription(front) {
	const lines = front.split(/\r?\n/);
	const index = lines.findIndex((line) => /^description:/.test(line));
	if (index === -1) return undefined;
	const inline = lines[index].replace(/^description:[ \t]*/, "").trim();
	if (inline !== "" && inline !== "|" && inline !== ">") return inline.replace(/^["']|["']$/g, "");
	const block = [];
	for (let i = index + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (line.trim() !== "" && !/^\s/.test(line)) break;
		block.push(line);
	}
	while (block.length > 0 && block[block.length - 1].trim() === "") block.pop();
	const indents = block.filter((line) => line.trim() !== "").map((line) => /^\s*/.exec(line)[0].length);
	const common = indents.length > 0 ? Math.min(...indents) : 0;
	const text = block.map((line) => line.slice(common)).join(inline === ">" ? " " : "\n").trim();
	return text === "" ? undefined : text;
}

/**
 * 解析一份 SKILL.md。
 * @param raw - 文件原文。
 * @param path - 文件路径（用于报错）。
 * @returns 技能元数据与正文。
 */
function parseSkill(raw, path) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
	if (match === null) throw new Error(`${PROVIDER_NAME}: ${path} 缺少 YAML frontmatter`);
	const front = match[1];
	const skillName = readScalar(front, "name");
	if (skillName === undefined || !SKILL_NAME_RE.test(skillName)) {
		throw new Error(`${PROVIDER_NAME}: ${path} 的 name 缺失或不是 kebab-case`);
	}
	const description = readDescription(front);
	if (description === undefined) throw new Error(`${PROVIDER_NAME}: ${path} 缺少 description`);
	return {
		name: skillName,
		description,
		whenToUse: readScalar(front, "whenToUse"),
		content: raw.slice(match[0].length).trim()
	};
}

/** 列出待扫描的 SKILL.md 路径（根目录 + skills/<name>/）。 */
function skillFiles() {
	const files = [];
	const rootSkill = join(PLUGIN_ROOT, "SKILL.md");
	if (existsSync(rootSkill)) files.push(rootSkill);
	const skillsDir = join(PLUGIN_ROOT, "skills");
	if (existsSync(skillsDir)) {
		for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const file = join(skillsDir, entry.name, "SKILL.md");
			if (existsSync(file)) files.push(file);
		}
	}
	return files;
}

/**
 * 扫描并构造 provider 候选。
 * @param onError - 单个文件解析失败时的回调。
 * @returns 候选数组。
 */
function scanCandidates(onError) {
	const candidates = [];
	for (const file of skillFiles()) {
		try {
			const parsed = parseSkill(readFileSync(file, "utf8"), file);
			candidates.push({
				name: parsed.name,
				description: parsed.description,
				...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
				invocation: { modelInvocable: true, userInvocable: true },
				provider: PROVIDER_NAME,
				source: "runtime",
				rank: PLUGIN_SKILL_RANK,
				resourceBase: { kind: "directory", path: dirname(file) },
				locator: file
			});
		} catch (error) {
			onError?.(error);
		}
	}
	return candidates;
}

/**
 * 挂载插件：注册只读技能 provider，并监听 SKILL.md 变化。
 * @param ctx - cordis 宿主上下文（需含 skills 服务）。
 */
export function apply(ctx) {
	/** provider 在 apply 期同步创建；候选缓存由文件变更刷新。 */
	ctx.effect(
		() => {
			const watchers = [];
			let candidates = scanCandidates((error) => ctx.logger?.warn?.(String(error?.message ?? error)));
			const provider = {
				name: PROVIDER_NAME,
				list: () => Promise.resolve(candidates),
				async get(candidate, options) {
					const { rank: _rank, locator, ...summary } = candidate;
					const raw = await readFile(locator, { encoding: "utf8", signal: options?.signal });
					return { ...summary, content: parseSkill(raw, locator).content };
				}
			};
			const dispose = ctx.skills.registerProvider((control) => {
				const refresh = () => {
					candidates = scanCandidates((error) => ctx.logger?.warn?.(String(error?.message ?? error)));
					try {
						control.invalidate();
					} catch {
						/* ignore */
					}
				};
				for (const file of skillFiles()) {
					try {
						const watcher = watch(file, { persistent: true }, refresh);
						watcher.on?.("error", () => {});
						// 不要因为监听句柄而单独撑住宿主进程的事件循环
						watcher.unref?.();
						watchers.push(watcher);
					} catch {
						/* 某些平台不支持监听则退化为重启生效 */
					}
				}
				const names = candidates.map((candidate) => candidate.name).join(", ");
				ctx.logger?.info?.(`${PROVIDER_NAME}: 已注册技能 [${names}]（rank ${PLUGIN_SKILL_RANK}）`);
				if (process.env.DSH_SKILL_PROBE === "1") {
					process.stdout.write(`[probe] ${PROVIDER_NAME}: registered [${names}] rank=${PLUGIN_SKILL_RANK}\n`);
				}
				return provider;
			});
			return () => {
				for (const watcher of watchers) {
					try {
						watcher.close();
					} catch {
						/* ignore */
					}
				}
				try {
					dispose?.();
				} catch {
					/* ignore */
				}
			};
		},
		"attention-scheduler: skill provider"
	);
}
