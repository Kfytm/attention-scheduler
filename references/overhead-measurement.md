# 上下文成本实测（口径、脚本与依据）

规则里的数字**必须**按运行环境实测。本技能把上下文成本分成三类，因为它们的**性质完全不同**：

| 类别 | 内容 | 性质 |
|---|---|---|
| **固定开销** | 系统提示 + 工具定义 | 每轮都在；与记忆系统无关；只能靠"少装工具/精简提示"降 |
| **L0 骨架注入** | 工作区指令、记忆骨架（人格/协议/索引） | 每轮都在，但内容稳定；**去重**能消除重复副本 |
| **L1 动态召回** | 每轮按查询命中的记忆片段 | **累积成本**：注入消息留在历史里直到被压缩 |

## 口径

| 项 | 来源 | 说明 |
|---|---|---|
| 系统提示 | 会话日志 `system/message`（`source.kind = "system-prompt"`）| 取文本字符数的最大值 |
| 工具定义 | 会话日志 `request/header`（`data.header.tools`）| 取 `JSON.stringify(tools).length` |
| L0 骨架 | 日志里 `source.kind = "agent-instructions"` 的消息 | 条数 + 字符数 |
| L1 动态召回 | 日志里 `source.kind = "plugin:memos-local-memory"` 的消息 | 条数 + 字符数 |
| 模型上下文窗口 | `request/context` 的 `contextWindow` | 用于压缩触发阈值 |
| 输出上限 | `request/header` 的 `data.header.config.maxTokens` | 注意：这是**上限**，不等于"输出预留" |

token 估算：中英混排按 **≈3.2 字符/token**（保守估算；纯英文 JSON 约 4 字符/token）。
若需精确值，请用目标模型的 tokenizer 复核。

> 计数说明：会话日志里同一条注入可能同时出现在 `agent/inbox/spliced` 与 `user/message` 两类事件中，
> 因此脚本只统计 `user/message`，避免重复计数。

## 用法

```bash
node scripts/measure-overhead.cjs --session "<path/to/session.v4.jsonl.zstd>"
```

可选参数：

| 参数 | 说明 |
|---|---|
| `--session <file>` | 指定会话日志（`.zstd`，支持多帧）|
| `--bytes-per-token <n>` | 覆盖 3.2 的估算比例，默认 3.2 |
| `--json` | 输出 JSON，便于脚本回填文档 |

输出示例（本机实测，2026-10-06）：

```
【固定开销】每轮都在，与记忆系统无关
  系统提示   : 8440 字符 ≈ 2638 tokens
  工具定义   : 42 个, 32051 字符 ≈ 10016 tokens
  合计       : ≈ 12653 tokens

【常驻注入】留在历史里累积，直到被压缩
  骨架注入   : 2 条, 5830 字符 ≈ 1822 tokens
  动态召回   : 47 条, 169158 字符 ≈ 52862 tokens   ← 对照组：自动召回全开的会话
```

## 会话日志在哪

- 默认 DSH：`$DSH_HOME/sessions/<workspace>/<session-id>/session.v4.jsonl.zstd`
- 老会话可能是 `session.jsonl.zstd`（v3 格式，同样支持）

日志是**多帧 zstd**（每帧一段追加内容），脚本按 magic number `28 B5 2F FD` 逐帧解压。

## 回填

把实测结果填回 `SKILL.md` 的 §一.7 与 §七.6，并递增 frontmatter 的 `metadata.version`。
建议同时记录：模型名、工具个数、测量日期。

---

## 依据（References）

本技能里关于"注入形态与成本"的判断，来自以下可复核的来源：

1. **DSH 运行时上下文是 in-history 投放的** —— 会话日志 `request/context` 事件里带
   `systemPromptUpdate: "in-history"`；因此"常驻注入"的真实形态是"在历史里保留一份"，
   而不是"每轮免费重放"。
2. **`agent-instructions` 的替换语义** —— DSH 的 `@deepseek-ai/dsh-agent-instructions`
   实现里存在 "complete baseline 取代此前所有 baseline" 的语义（`REPLACEMENT_AGENT_INSTRUCTIONS_INTRO`），
   并且有按内容摘要（SHA-1）去重的逻辑；指令文件候选为 `AGENTS.md` / `CLAUDE.md`（及 `.local` 变体），
   用户全局文件是 `$DSH_HOME/AGENTS.md`。
3. **memos 的注入路径与开关** —— `@memtensor/memos-local-plugin`（2.0.20）的
   `dist/adapters/deepseek-harness/bridge.js` 在 `agent/pre-step` 水落线里把召回内容作为一条消息追加
   （`if (!context) return decision`，只有空内容才跳过，**没有"与上次相同则跳过"的去重**）；
   开关与体积由适配器配置 `recallEnabled` / `contextMaxChars` / `toolResultMaxChars` 控制。
4. **"变化才注入"的对比样本** ——
   [LittleBlackTong/dsh-plugin-memory](https://github.com/LittleBlackTong/dsh-plugin-memory)
   （[dshbase 页](https://dshbase.com/zh/plugins/dsh-plugin-memory/)）在其 README 中说明：
   boot 块通过 `ctx.systemPrompt.context()` 注入，宿主按投影去重；内容不变不重复注入，
   变化时新快照取代旧快照。这正是 L0 的推荐形态。
5. **注入是累积成本** —— 本机会话日志实测：
   66 轮会话中动态召回 47 条、169,158 字符（≈52,862 tokens），而同会话固定开销仅 2,653 tokens。
   复现命令即上文脚本。
