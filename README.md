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
| **L0/L1 成本归属** | 骨架常驻（计入固定开销）vs 动态召回（计入注入预算）：谁该花 token |
| **记忆注入** | 召回数 vs 注入数、注入预算（工作记忆 20%–25%）、超限淘汰 |
| **冲突与写回** | 冲突优先级、写回白名单/黑名单、写回格式与版本链（`superseded`）|
| **实测脚本** | `scripts/measure-overhead.cjs`：从会话日志分别量出**固定开销 / L0 骨架 / L1 动态召回**三类成本 |
| **配置落点表** | `references/config-map.md`：哪些条款只能靠配置强制，以及"注入形态对照表" |

## 安装

### 方式一：作为插件安装（推荐 · 一条命令）

本仓库同时是**标准 DSH 插件**（`package.json` 带 `dsh.bundle.patch`），插件加载时会把技能
注册进技能注册表（`ctx.skills.registerProvider()`），因此可以直接：

```sh
# 从 GitHub 安装（任意 profile）
dsh plugin --profile web add github:<user>/attention-scheduler

# 本地开发：用 link 方式，改完即生效
dsh plugin --profile web add link:D:\path\to\attention-scheduler
```

装完**重启该 profile**即可用。卸载：`dsh plugin --profile web remove dsh-attention-scheduler`。

> 优点：技能随插件版本走（可 `dsh plugin update`）；`SKILL.md` 变化会热刷新，无需重启宿主。
> rank = 250，低于用户本地文件技能（400）与官方内置技能（600），**你放在 `~/.dsh/skills/` 的同名技能会覆盖它**。

### 方式二：作为文件技能安装（脚本 / 手工）

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
├── package.json                      # 插件清单（dsh.bundle.patch → 一键安装）
├── cordis.patch.yml                  # bundle 挂载清单（insert 一行）
├── lib/index.js                      # 插件半边：注册运行期技能 provider（零依赖）
├── README.md
├── LICENSE                           # MIT
├── CHANGELOG.md
├── references/
│   ├── config-map.md                 # 配置落点 + 注入形态对照表（L0/L1）
│   └── overhead-measurement.md       # 三类上下文成本的测量口径与依据
└── scripts/
    ├── install.ps1                   # Windows 文件技能安装
    ├── install.sh                    # macOS/Linux 文件技能安装
    └── measure-overhead.cjs          # 固定开销 / L0 / L1 三类成本实测
```

## 参考与依据（References）

技能里关于**注入形态与成本**的判断都可以复核，来源如下：

### DSH 本体（本机安装包实测 + 会话日志）

| 结论 | 依据 |
|---|---|
| 运行时上下文是 **in-history** 投放 | 会话日志 `request/context` 事件含 `systemPromptUpdate: "in-history"` |
| 指令文件是"**替换基线**"语义（内容不变不新增副本）| `@deepseek-ai/dsh-agent-instructions` 中的 `REPLACEMENT_AGENT_INSTRUCTIONS_INTRO` 与按 SHA-1 去重逻辑 |
| 指令文件候选与预算 | 同包：`AGENTS.md` / `CLAUDE.md`（含 `.local`），用户全局为 `$DSH_HOME/AGENTS.md`，官方默认 `maxBytes: 65536` |
| 技能排序权重 | `@deepseek-ai/dsh-skill-filesystem`：project-dsh 100 / project-agents 200 / custom 300 / user-dsh 400 / user-agents 500；`@deepseek-ai/dsh-skill`：runtime 250、bundled 600 |
| 运行期技能注册范式 | `@deepseek-ai/dsh-skill-office`：`{ name, description, invocation, provider, source, rank, resourceBase, locator }` + `ctx.skills.registerProvider()` |

### 记忆插件（对照样本）

| 项目 | 引用要点 |
|---|---|
| [LittleBlackTong/dsh-plugin-memory](https://github.com/LittleBlackTong/dsh-plugin-memory)（[dshbase 页](https://dshbase.com/zh/plugins/dsh-plugin-memory/)）| L0 常驻骨架的推荐形态：boot 块经 `ctx.systemPrompt.context()` 注入，**按投影去重**（不变不重复、变化时新快照取代旧的）；另有 `bootMaxChars` 体积预算 |
| `@memtensor/memos-local-plugin` 2.0.20 | L1 动态召回的对照：`dist/adapters/deepseek-harness/bridge.js` 在 `agent/pre-step` 追加消息，**无去重**；开关与体积为 `recallEnabled` / `contextMaxChars` / `toolResultMaxChars` |

### 同主题项目（选型时的横向参考）

- [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering)（含 `skills/context-compression`）
- [kimtth/agent-skill-100-lines-or-less](https://github.com/kimtth/agent-skill-100-lines-or-less)（技能正文 ≤100 行的篇幅主张）
- [monotykamary/dsh-fovea](https://github.com/monotykamary/dsh-fovea)（token 预算化的聚焦/影响分析）、[stas130286-blip/dsh-brainagent](https://github.com/stas130286-blip/dsh-brainagent)、[dsh-token-headroom](https://github.com/rob-x-ai/awesome-dsh-plugin)（上下文压缩）
- 目录站：[dshbase 插件目录](https://dshbase.com/zh/plugins/directory/)、[awesome-dsh-plugin](https://github.com/rob-x-ai/awesome-dsh-plugin)、[awesome-dsh-list](https://github.com/kingselyjoe/awesome-dsh-list)

### 本仓库自测数据

| 会话 | 轮次 | L0 骨架 | L1 动态召回 |
|---|---|---|---|
| 六爻会话 | 66 | 0 | 47 条 / 169,158 字符 ≈ **52,862 tokens（占上下文成本 95%）** |
| 本机主会话 | 96 | 2 条 / 5,830 字符 ≈ 1,822 tokens | 4 条 / 6,044 字符 ≈ 1,889 tokens |

复现：`node scripts/measure-overhead.cjs --session <会话日志>`。

## 设计原则

- **行为归提示词，数字归配置**：规则文本能约束"该不该查"；"召回几条、上限多少"必须落到配置。
- **默认不改配置**：需要改记忆系统配置时，先备份、再改、再验证，并明确告知用户改了什么。
- **数字要实测**：任何 token 数字都应可用脚本复现；写进规则的必须是实测值 + 测量日期。

## 兼容性

- 技能格式：`SKILL.md`（YAML frontmatter: `name`、`description`）+ 可选 `references/`、`scripts/`
- 配置落点表基于 DSH + MemOS 本地插件；其他环境请对照同类实现调整

## License

MIT
