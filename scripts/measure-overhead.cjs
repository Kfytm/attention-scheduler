#!/usr/bin/env node
/**
 * measure-overhead.cjs —— 实测 DSH 会话的"固定开销"（系统提示 + 工具定义）。
 *
 * 用法：
 *   node scripts/measure-overhead.cjs --session "<path/to/session.v4.jsonl.zstd>"
 *   node scripts/measure-overhead.cjs --session <file> --bytes-per-token 3.2 --json
 *
 * 说明：
 *   - 会话日志是多帧 zstd（每帧一段追加内容），按 magic number 逐帧解压；
 *   - 系统提示取 `system/message`（source.kind = "system-prompt"）的文本字符数；
 *   - 工具定义取 `request/header` 的 data.header.tools 的 JSON 体积；
 *   - token 为估算值（默认 3.2 字符/token），需要精确值请用目标模型 tokenizer 复核。
 */
const fs = require("node:fs");
const zlib = require("node:zlib");

/** 解析命令行参数。 */
function parseArgs(argv) {
	const out = { session: null, bytesPerToken: 3.2, json: false };
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

/** 从会话行里提取系统提示、工具表、上下文窗口与 maxTokens。 */
function extract(lines) {
	let systemPromptChars = 0;
	let header = null;
	let context = null;
	for (const line of lines) {
		if (line.includes('"kind":"system-prompt"')) {
			try {
				const parsed = JSON.parse(line);
				const content = parsed?.data?.content ?? parsed?.data?.message?.content;
				const text = Array.isArray(content) ? content.map((b) => b.text ?? "").join("") : "";
				if (text.length > 200) systemPromptChars = text.length;
			} catch {
				/* ignore */
			}
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
	}
	const tools = Array.isArray(header?.tools) ? header.tools : [];
	return { systemPromptChars, tools, toolsJsonChars: JSON.stringify(tools).length, header, context };
}

const args = parseArgs(process.argv);
if (args.help || args.session === null) {
	console.log("用法: node scripts/measure-overhead.cjs --session <session.*.jsonl.zstd> [--bytes-per-token 3.2] [--json]");
	process.exit(args.help ? 0 : 1);
}
if (!fs.existsSync(args.session)) {
	console.error(`找不到会话日志: ${args.session}`);
	process.exit(2);
}

const lines = readSessionLines(args.session);
const { systemPromptChars, tools, toolsJsonChars, header, context } = extract(lines);
const per = args.bytesPerToken;
const est = (chars) => Math.round(chars / per);
const result = {
	session: args.session,
	systemPromptChars,
	systemPromptTokens: est(systemPromptChars),
	toolCount: tools.length,
	toolsJsonChars,
	toolsTokens: est(toolsJsonChars),
	fixedOverheadTokens: est(systemPromptChars + toolsJsonChars),
	provider: header?.config?.provider ?? null,
	model: header?.config?.model ?? null,
	reasoningEffort: header?.config?.reasoningEffort ?? null,
	maxTokens: header?.config?.maxTokens ?? null,
	contextWindow: context?.contextWindow ?? null,
	toolNames: tools.map((t) => t.name),
	bytesPerToken: per
};

if (args.json) {
	console.log(JSON.stringify(result, null, 2));
} else {
	console.log("=== 固定开销实测 ===");
	console.log(`会话日志     : ${result.session}`);
	console.log(`系统提示     : ${result.systemPromptChars} 字符  ≈ ${result.systemPromptTokens} tokens`);
	console.log(`工具定义     : ${result.toolCount} 个工具, ${result.toolsJsonChars} 字符  ≈ ${result.toolsTokens} tokens`);
	console.log(`固定开销合计 : ≈ ${result.fixedOverheadTokens} tokens  （按 ${per} 字符/token 估算）`);
	console.log(`模型         : ${result.provider}/${result.model}  effort=${result.reasoningEffort}  maxTokens=${result.maxTokens}`);
	console.log(`上下文窗口   : ${result.contextWindow}`);
}
