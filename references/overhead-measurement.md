# 固定开销实测（口径与脚本）

规则里的"固定开销"= **系统提示 + 工具定义**，它既不进入工作记忆，也无法靠提示词控制。
不同模型、不同插件组合下差别很大，所以必须实测而不是沿用别人的数字。

## 口径

| 项 | 来源 | 说明 |
|---|---|---|
| 系统提示 | 会话日志里的 `system/message`（`source.kind = "system-prompt"`） | 取文本字符数 |
| 工具定义 | 会话日志里的 `request/header`（`data.header.tools`） | 取 `JSON.stringify(tools).length` |
| 模型上下文窗口 | `request/context` 的 `contextWindow` | 用于压缩触发阈值 |
| 输出上限 | `request/header` 的 `data.header.config.maxTokens` | 注意：这是**上限**，不等于"输出预留" |

token 估算：中英混排按 **≈3.2 字符/token**（保守估算；纯英文 JSON 约 4 字符/token）。
若需精确值，请用目标模型的 tokenizer 复核。

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

## 会话日志在哪

- 默认 DSH：`$DSH_HOME/sessions/<workspace>/<session-id>/session.v4.jsonl.zstd`
- 老会话可能是 `session.jsonl.zstd`（v3 格式，同样支持）

日志是**多帧 zstd**（每帧一段追加内容），脚本按 magic number `28 B5 2F FD` 逐帧解压。

## 回填

把实测结果填回 `SKILL.md` 的 §一.7，并递增 frontmatter 的 `metadata.version`。
建议同时记录：模型名、工具个数、测量日期。
