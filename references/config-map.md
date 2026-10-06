# 配置落点对照表

规则分两类：**行为条款**（靠提示词/技能约束即可）与**机制参数**（必须改配置才真生效）。
下表给的是 DSH + MemOS 环境下的实际落点；其他环境请对照同类实现。

> 原则：**默认不改配置**。确需更改时：先备份 → 再改 → 再验证 → 告知用户改了哪一项。

## 1. MemOS（DSH 本地插件）

| 规则条款 | 配置文件 | 键 | 说明 |
|---|---|---|---|
| 自动召回开关 | `profiles/<profile>/cordis.patch.yml` | `memos-local-memory.recallEnabled` | `false` = 默认不注入，改为模型主动检索（本技能假定的默认）|
| 注入字符上限 | 同上 | `contextMaxChars` | 单次召回可注入的字符预算 |
| 工具结果上限（DSH 侧） | 同上 | `toolResultMaxChars` | 回灌进上下文的工具结果长度 |
| 捕获侧工具输出 | `~/.dsh/memos-plugin/config.yaml` | `algorithm.capture.maxToolOutputChars` | 写入记忆前的截断 |
| 召回/注入条数 | 同上 | `algorithm.retrieval.tier1TopK` / `tier2TopK` / `tier3TopK`、`llmFilterMaxKeep` | 对应规则 §六 的"召回/注入条数" |
| 检索权重与淘汰 | 同上 | `weightCosine` / `weightPriority` / `mmrLambda` / `relativeThresholdFloor` | 相关性、时效性淘汰的权重 |

示例（把 §六 的"简单任务：召回 15 → 注入 3"落到机制）：

```yaml
algorithm:
  retrieval:
    tier1TopK: 15
    llmFilterMaxKeep: 3
```

> `recallEnabled` 之类是**插件行配置**，改完需要重启宿主才生效（DSH 在启动时装配配置）。

## 2. DSH 本体

| 规则条款 | 落点 | 说明 |
|---|---|---|
| 保留轮次 / 旧轮次压缩 | **无直接旋钮** | DSH 使用自动 compaction；只能在提示词层做软约束，或自行实现 |
| 工具输出截断 | `tools` 行配置 / 各工具自身 | 影响单次工具结果进入上下文的长度 |
| 固定开销 | 由"启用插件数 → 工具个数"决定 | 装卸插件后必须重测（见 `overhead-measurement.md`）|
| 全局行为条款 | `~/.dsh/AGENTS.md` | 全局指令文件，改完下一轮即生效，无需重启 |
| 项目级行为条款 | `<project>/AGENTS.md` | 只对当前工作区生效；`AGENTS.local.md` 为本地覆盖 |

## 2.5 注入形态对照表（L0 / L1）

"注入"有两条完全不同的通道，成本形态也不同——**选错通道会让 token 成本差一个数量级**：

| | L0 常驻骨架 | L1 动态召回 |
|---|---|---|
| 典型内容 | 工作区指令、人格/协议/索引、会话标签、当前任务目标 | 与当前问题相关的记忆片段 |
| 典型通道 | `AGENTS.md` 指令文件；或 `ctx.systemPrompt.context()`（运行时上下文）| `agent/pre-step` 追加一条消息（memos 的做法）|
| 变化频率 | 极低 | 每轮可能不同 |
| 去重效果 | **显著**：内容不变就不新增副本（`agent-instructions` 一类是 "complete baseline 取代此前 baseline" 语义）| **几乎为零**：每轮内容不同，无从去重 |
| 真实成本 | 那一份 × 每轮（去重只消除"重复副本"）| 单次体积 × 注入频次，且**累积在历史里**直到被压缩 |
| 计入 | 固定开销 | 注入预算（§七）|

**结论**：想让某个东西"永远在场"，就用 L0（把它做得小、稳）；想让某个东西"按需出现"，就用 L1
（由检索触发规则控制频率，由 `contextMaxChars` 一类配置控制体积）。

**当前可实现性**（本机实测）：

| 能力 | 现状 |
|---|---|
| 关掉 L1 自动召回 | ✅ memos `recallEnabled: false`（默认即 false，插件 bundle 与 profile patch 均可设）|
| 限制 L1 单次体积 | ✅ memos `contextMaxChars` |
| 让 L1 可被压缩淘汰 | ⚠️ 取决于宿主的 compaction 策略；本规则只能在提示词层约束 |
| L0 去重注入 | ✅ 走指令文件（`AGENTS.md`）或 `systemPrompt.context()`；指令文件的预算是 `maxBytes`（官方默认 65536）|

## 3. 判定口诀

- 能写进"规则文本"的（该不该查、先问谁、保留什么）→ 提示词 / 技能 / `AGENTS.md`
- 只能表达为"数字或开关"的（条数、字符上限、开/关）→ 配置文件
- 改配置前先确认：改了会不会影响其他会话？是否需要重启？能否回滚？
