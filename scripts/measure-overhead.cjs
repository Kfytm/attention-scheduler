#!/usr/bin/env node
/**
 * measure-overhead.cjs —— 实测 DSH 会话的三类上下文成本：
 *
 *   1. 固定开销  = 系统提示 + 工具定义（每轮都在，与记忆系统无关）
 *   2. 骨架注入  = 稳定的工作区指令 / 记忆骨架（agent-instructions、boot 块一类）
 *   3. 动态召回  = 每轮按查询命中的记忆注入（memos 一类）
 *
 * 后两类合称"常驻注入"：注入消息会留在历史里直到被压缩，因此成本是**累积**的，
 * 这正是"降频 / 限体积 / 及时压缩"三条策略要管的量。
 *
 * 用法：
 *   node scripts/measure-overhead.cjs --session "<path/to/session.v4.jsonl.zstd>"
 *   node scripts/measure-overhead.cjs --session <file> --bytes-per-token 3.2 --json
 *
 * 口径与依据见 references/overhead-measurement.md。
 */
const fs = require("node:fs");
const zlib = require("node:zlib");

/** 解析命令行参数。 */
function parseArgs(argv) {
	const out = { session: null, bytesPerToken: 3.2, json: false, help: false };
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--session") out.session = argv[++i];
		else if (arg === "--bytes-per-token") out.bytesPerToken = Number(argv[++i]) || out.bytesPerToken;
		else if (arg === "--json") out.json = true;
		else if (arg === "--help" || arg === "-h") out.help = true;
	}
	return out;
}

/** 逐帧解压 zstd，返回全部文本行。 */
function readSessionLines(file) {
	const buf = fs.readFileSync(file);
	const offsets = [];
	for (let i = 0; i + 3 < buf.length; i += 1) {
		if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i);
	}
	const parts = [];
	if (offsets.length === 0) parts.push(buf.toString("utf8"));
	else {
		for (const off of offsets) {
			try {
				parts.push(zlib.zstdDecompressSync(buf.subarray(off)).toString("utf8"));
			} catch {
				/* 跳过损坏帧 */
			}
		}
	}
	return parts.join("").split("\n").filter(Boolean);
}

/** 从一行消息事件里取出文本长度与来源 kind。 */
function readMessage(line) {
	try {
		const parsed = JSON.parse(line);
		const data = parsed?.data ?? {};
		const message = data.message ?? data.inserted?.[0] ?? data;
		const content = message?.content;
		const text = Array.isArray(content) ? content.map((block) => block.text ?? "").join("") : "";
		const kind = message?.source?.kind ?? data?.source?.kind ?? "";
		return { type: parsed?.type ?? "", kind, chars: text.length };
	} catch {
		return null;
	}
}

/** 汇总一次会话的各类成本。 */
function measure(lines) {
	let turns = 0;
	let systemPromptChars = 0;
	let systemPromptRounds = 0;
	let header = null;
	let context = null;
	const skeletonKinds = new Set(["agent-instructions", "system-prompt"]);
	const recallKinds = new Set(["plugin:memos-local-memory"]);
	let skeletonCount = 0;
	let skeletonChars = 0;
	let recallCount = 0;
	let recallChars = 0;

	for (const line of lines) {
		if (line.includes('"type":"turn/start"')) turns += 1;
		if (line.includes('"kind":"system-prompt"')) {
			systemPromptRounds += 1;
			const parsed = readMessage(line);
			if (parsed !== null && parsed.chars > 200) systemPromptChars = Math.max(systemPromptChars, parsed.chars);
		}
		if (line.includes('"type":"request/header"')) {
			try {
				header = JSON.parse(line).data.header;
			} catch {
				/* ignore */
			}
		}
		if (line.includes('"type":"request/context"')) {
			try {
				context = JSON.parse(line).data;
			} catch {
				/* ignore */
			}
		}
		if (!line.includes('"type":"user/message"') && !line.includes('"kind":"agent-instructions"') && !line.includes("memos-local-memory")) continue;
		const message = readMessage(line);
		if (message === null || message.chars === 0) continue;
		if (skeletonKinds.has(message.kind)) {
			skeletonCount += 1;
			skeletonChars += message.chars;
		} else if (recallKinds.has(message.kind)) {
			recallCount += 1;
			recallChars += message.chars;
		}
	}

	const tools = Array.isArray(header?.tools) ? header.tools : [];
	return {
		turns,
		systemPromptChars,
		systemPromptRounds,
		systemPromptTokens: 0,
		toolCount: tools.length,
		toolsJsonChars: JSON.stringify(tools).length,
		skeletonCount,
		skeletonChars,
		recallCount,
		recallChars,
		header,
		context,
		toolNames: tools.map((tool) => tool.name)
	};
}

const args = parseArgs(process.argv);
if (args.help || args.session === null) {
	console.log(
		"用法: node scripts/measure-overhead.cjs --session <session.*.jsonl.zstd> [--bytes-per-token 3.2] [--json]"
	);
	process.exit(args.help ? 0 : 1);
}
if (!fs.existsSync(args.session)) {
	console.error(`找不到会话日志: ${args.session}`);
	process.exit(2);
}

const per = args.bytesPerToken;
const est = (chars) => Math.round(chars / per);
const raw = measure(readSessionLines(args.session));
const result = {
	session: args.session,
	turns: raw.turns,
	systemPromptChars: raw.systemPromptChars,
	systemPromptTokens: est(raw.systemPromptChars),
	toolCount: raw.toolCount,
	toolsJsonChars: raw.toolsJsonChars,
	toolsTokens: est(raw.toolsJsonChars),
	fixedOverheadChars: raw.systemPromptChars + raw.toolsJsonChars,
	fixedOverheadTokens: est(raw.systemPromptChars + raw.toolsJsonChars),
	skeletonCount: raw.skeletonCount,
	skeletonChars: raw.skeletonChars,
	skeletonTokens: est(raw.skeletonChars),
	recallCount: raw.recallCount,
	recallChars: raw.recallChars,
	recallTokens: est(raw.recallChars),
	injectedChars: raw.skeletonChars + raw.recallChars,
	injectedTokens: est(raw.skeletonChars + raw.recallChars),
	provider: raw.header?.config?.provider ?? null,
	model: raw.header?.config?.model ?? null,
	reasoningEffort: raw.header?.config?.reasoningEffort ?? null,
	maxTokens: raw.header?.config?.maxTokens ?? null,
	contextWindow: raw.context?.contextWindow ?? null,
	toolNames: raw.toolNames,
	bytesPerToken: per
};

if (args.json) {
	console.log(JSON.stringify(result, null, 2));
} else {
	const pct = (value) => (result.fixedOverheadChars + result.injectedChars === 0 ? "0%" : `${Math.round((value / (result.fixedOverheadChars + result.injectedChars)) * 100)}%`);
	console.log("=== 上下文成本实测 ===");
	console.log(`会话日志     : ${result.session}`);
	console.log(`轮次数       : ${result.turns}`);
	console.log("");
	console.log("【固定开销】每轮都在，与记忆系统无关");
	console.log(`  系统提示   : ${result.systemPromptChars} 字符 ≈ ${result.systemPromptTokens} tokens`);
	console.log(`  工具定义   : ${result.toolCount} 个, ${result.toolsJsonChars} 字符 ≈ ${result.toolsTokens} tokens`);
	console.log(`  合计       : ≈ ${result.fixedOverheadTokens} tokens`);
	console.log("");
	console.log("【常驻注入】留在历史里累积，直到被压缩");
	console.log(`  骨架注入   : ${result.skeletonCount} 条, ${result.skeletonChars} 字符 ≈ ${result.skeletonTokens} tokens  (${pct(result.skeletonChars)})`);
	console.log(`  动态召回   : ${result.recallCount} 条, ${result.recallChars} 字符 ≈ ${result.recallTokens} tokens  (${pct(result.recallChars)})`);
	console.log(`  注入合计   : ≈ ${result.injectedTokens} tokens`);
	if (result.turns > 0) {
		console.log(`  平均每轮   : 骨架 ${Math.round(result.skeletonChars / result.turns)} 字符 / 召回 ${Math.round(result.recallChars / result.turns)} 字符`);
	}
	console.log("");
	console.log(`模型         : ${result.provider}/${result.model}  effort=${result.reasoningEffort}  maxTokens=${result.maxTokens}`);
	console.log(`上下文窗口   : ${result.contextWindow}`);
	console.log(`（按 ${per} 字符/token 估算；口径见 references/overhead-measurement.md）`);
}
