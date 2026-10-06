# 重塑指南（宿主破坏性更新后怎么办）

**一句话结论**：**规则可以依赖，胶水不可以。** 规则文本（`SKILL.md` §一–§十）是跨版本、甚至跨 harness 的
不变量；而"把规则接进宿主"的适配代码、以及"测量口径"依赖宿主实现细节，破坏性更新时需要重写——
但重写是**有清单、可验证**的工作，而不是重新发明规则。

## 1. 三个圈层：破坏性更新后各自要做什么

| 圈层 | 内容 | 依赖宿主？ | 更新后 |
|---|---|---|---|
| **核心圈（不变量）** | 四级触发（强制/禁止/强/弱/抑制）、优先级与冲突规则、L0/L1/L2 成本归属、保留轮次与优先级、压缩六要素、写回白名单/黑名单、冲突优先级 | ❌ 不依赖 | **原样保留**，它是重塑的依据 |
| **适配圈（胶水）** | `lib/index.js`（技能注册）、`cordis.patch.yml` / `package.json`（bundle 装载）、L0 的注入通道选择 | ✅ 强依赖 | **需要重写**，但只改这一圈 |
| **观测层（口径）** | `scripts/measure-overhead.cjs`（日志字段）、`references/config-map.md`（配置键）、`scripts/probe-assumptions.cjs`（探针本身） | ✅ 依赖实现细节 | **需要校准**，字段变了就改口径 |

判别口诀：**"该不该查"永远有效；"怎么接进去/怎么量出来"会过期。**

## 2. 绑定点清单（逐个可检测）

| # | 绑定点 | 依赖的具体符号 / 字段 / 路径 | 失效表现 | 探针检查 |
|---|---|---|---|---|
| 1 | 技能注册 | `ctx.skills.registerProvider(factory)`；候选 `{name,description,invocation,provider,source,rank,resourceBase,locator}` | 技能不出现在列表；加载报 unknown | `registerProvider 契约` |
| 2 | 排序权重 | user-dsh=400、bundled=600、runtime=250 | 本地文件技能不再能覆盖插件技能 | `user 层 rank=400` |
| 3 | 技能名与目录 | kebab-case；`<skills>/<name>/SKILL.md`（depth 1） | 技能被忽略并只留 warning | `kebab-case 技能名校验` |
| 4 | bundle 装载 | `package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml` 的 `insert` | `dsh plugin add` 后 profile 启动失败或插件未挂载 | 手动：`dsh --profile <p> --dump-config` |
| 5 | L0 通道 | `AGENTS.md` / `CLAUDE.md` 候选、`maxBytes` 预算、"complete baseline 取代旧 baseline"语义 | L0 不再自动注入，或去重结论失效（成本模型要改） | `AGENTS.md 候选` / `maxBytes` / `替换基线语义` |
| 6 | 观测字段 | 会话日志多帧 zstd；`request/header.data.header.tools`；`source.kind`：`system-prompt` / `agent-instructions`；`request/context.contextWindow` | 实测脚本报 0 或抛错 | `多帧 zstd` / `request/header` / `system-prompt` / `agent-instructions` |
| 7 | 记忆插件契约 | `recallEnabled`、`contextMaxChars`、`toolResultMaxChars`；召回经 `agent/pre-step` 注入且**无去重** | L1 开关/体积失效，或成本结论（"累积成本"）不再成立 | `recallEnabled` / `contextMaxChars` / `pre-step 注入路径` |

## 3. 重塑五步（可直接执行）

```bash
# 第 1 步：跑探针，看哪些绑定点漂移
node scripts/probe-assumptions.cjs --runtimes <pkgRoot> [--session <日志>]
```

1. **探针定位漂移**：只关心 `DRIFT` 的行——那是必须改的地方；`SKIP` 说明该能力在本次环境未启用，可忽略。
2. **只改适配圈**：按漂移项重写 `lib/index.js` / `cordis.patch.yml` / `package.json`。
   **绝不动 `SKILL.md` §一–§十 的规则文本**——那是资产。
3. **校准观测口径**：若日志字段变了，改 `scripts/measure-overhead.cjs` 的取值位置；
   若配置键变了，改 `references/config-map.md`；若假设本身变了，改探针的断言。
4. **更新 L0 结论（如需要）**：若第 5 项漂移（去重语义变化），必须回头修正 `SKILL.md` §七.4 的
   "L0/L1 成本归属"——这是**唯一可能触及核心圈**的情况，因为它是关于宿主机制的结论，不属于纯策略。
5. **版本与记录**：递增 `package.json` 与 `SKILL.md` 的 `metadata.version`，在 `CHANGELOG.md` 写明
   "针对 dsh x.y.z 的迁移：改了哪几个绑定点"。

## 4. 重塑验收标准

- [ ] `node scripts/probe-assumptions.cjs` 无 `DRIFT`（`SKIP` 可接受）
- [ ] 插件形态：`dsh plugin --profile <p> add link:<repo>` 后 profile 能正常启动
- [ ] 技能能被列出并加载（`skill` 工具或界面技能列表）
- [ ] `node scripts/measure-overhead.cjs --session <日志>` 能出三类成本数字
- [ ] 在真实会话里跑一次"该不该检索"的判断，规则可执行（不是空转）

## 5. 保持不变形的前提（本仓库已遵守）

1. **规则与代码物理分离**：`SKILL.md`（策略）／`lib/`（适配）／`scripts/`（观测）互不混写。
2. **假设集中登记**：所有对宿主的假设只出现在本文档第 2 节与探针里，不散落在规则正文中。
3. **结论标注来源**：涉及宿主机制的结论（如"去重省重复不省那一份"）都写明依据（见
   `overhead-measurement.md` 的 References），漂移时能快速定位是哪条依据失效。
4. **可复现数字**：规则里的 token 数一律来自脚本实测，不写"看起来合理"的估算——估算无法随宿主校准。

## 6. 极端情况：换 harness

如果宿主换成了另一个 agent 框架：**核心圈整体可搬运**（四级触发、预算归属、写回白名单都是策略语言），
需要重做的是第 2 节里除第 6 项外的全部绑定点。此时建议保留 `references/config-map.md` 作为
"新宿主落点表"的起点（逐条找对应能力），并用 `SKILL.md` §十三 的**文件技能形态**先跑通最小可用。
