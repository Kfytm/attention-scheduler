# attention-scheduler · 注意力调度规则

一套可复用的 **注意力 / 上下文 / 记忆** 使用规范，作为 [DeepSeek Harness](https://github.com/deepseek-ai) 的
**技能（Skill）** 分发：让模型在"该记什么、该查什么、该丢什么、该写回什么"上有一致、可审计的行为依据。

> 适用场景：会话很长、历史挤占上下文、回复被旧信息带偏；或团队希望统一"检索/记忆"的使用纪律。

## 包含内容

| 模块 | 说明 |
|---|---|
| **检索四级触发** | 强制 / 禁止 / 强 / 弱 / 抑制，含冲突优先级 |
| **跨会话检索约束** | 会话标签、隐私会话只查当前、项目命名空间 |
| **注意力预算** | 保留轮次、保留优先级、压缩摘要六要素、固定开销公式、压缩触发阈值 |
| **记忆注入** | 召回数 vs 注入数、注入预算（工作记忆 20%–25%）、超限淘汰 |
| **冲突与写回** | 冲突优先级、写回白名单/黑名单、写回格式与版本链（`superseded`）|
| **实测脚本** | `scripts/measure-overhead.cjs`：从会话日志量出"系统提示 + 工具定义"的真实开销 |

## 安装

### 方式一：脚本安装（推荐）

```powershell
# Windows（Windows PowerShell 5.1 亦可；若装了 PowerShell 7 可把 powershell 换成 pwsh）
git clone <this-repo> attention-scheduler
cd attention-scheduler
powershell -ExecutionPolicy Bypass -File scripts\install.ps1            # 复制安装
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Mode link # 或目录联接，便于开发
```

```bash
# macOS / Linux / WSL
git clone <this-repo> attention-scheduler
cd attention-scheduler
bash scripts/install.sh
```

安装位置：`$DSH_HOME/skills/attention-scheduler/`（默认 `~/.dsh/skills/`）。

### 方式二：手工复制

把 `SKILL.md`（以及 `references/`、`scripts/`）放进 `~/.dsh/skills/attention-scheduler/`：

```
~/.dsh/skills/attention-scheduler/
├── SKILL.md          ← 必需；DSH 只扫描 depth 1 的 <skill>/SKILL.md
├── references/
└── scripts/
```

技能名须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`（kebab-case）。安装后**无需重启**，DSH 会热发现。

## 使用

1. **按需加载**：在 DSH 里说"套用注意力调度规则"，或让模型调用 `skill` 工具加载 `attention-scheduler`。
2. **全局生效（可选）**：把本技能 §一–§九 的精简版写入 `~/.dsh/AGENTS.md`，
   每轮自动作为工作区指令注入，无需每次加载。
3. **复测开销**：

```bash
node scripts/measure-overhead.cjs --session "~/.dsh/sessions/<ws>/<session-id>/session.v4.jsonl.zstd"
```

输出示例：

```
系统提示     : 8440 字符  ≈ 2638 tokens
工具定义     : 42 个工具, 32051 字符  ≈ 10016 tokens
固定开销合计 : ≈ 12653 tokens  （按 3.2 字符/token 估算）
上下文窗口   : 1000000
```

把结果回填 `SKILL.md` §一.7 —— **不要沿用别人的数字**，它随模型与插件组合变化。

## 目录结构

```
attention-scheduler/
├── SKILL.md                          # 技能主体（frontmatter: name/description）
├── README.md
├── LICENSE                           # MIT
├── CHANGELOG.md
├── references/
│   ├── config-map.md                 # 哪些条款必须落到配置才生效（含安全原则）
│   └── overhead-measurement.md       # 固定开销的测量口径
└── scripts/
    ├── install.ps1                   # Windows 安装
    ├── install.sh                    # macOS/Linux 安装
    └── measure-overhead.cjs          # 固定开销实测
```

## 设计原则

- **行为归提示词，数字归配置**：规则文本能约束"该不该查"；"召回几条、上限多少"必须落到配置。
- **默认不改配置**：需要改记忆系统配置时，先备份、再改、再验证，并明确告知用户改了什么。
- **数字要实测**：任何 token 数字都应可用脚本复现；写进规则的必须是实测值 + 测量日期。

## 兼容性

- 技能格式：`SKILL.md`（YAML frontmatter: `name`、`description`）+ 可选 `references/`、`scripts/`
- 配置落点表基于 DSH + MemOS 本地插件；其他环境请对照同类实现调整

## License

MIT
