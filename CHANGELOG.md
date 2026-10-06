# Changelog

本文件记录本技能的规则版本。规则语义变更请递增 minor，措辞/错别字修正用 patch。

## 2.4.1 — 2026-10-06

- 元数据落实：版权人与仓库信息填入 Kfytm
  - LICENSE 与 README.md 的版权行改为 `Copyright (c) 2026 Kfytm`
  - package.json 新增 `author` / `repository` / `homepage` / `bugs`
  - 安装与克隆命令里的占位符 `<user>` / `<this-repo>` 替换为真实地址
    （`dsh plugin add github:Kfytm/attention-scheduler`）

## 2.4.0 — 2026-10-06

- 明确**技能宗旨**：本技能旨在**减轻、消除 AI 上下文幻觉问题**（针对"历史污染"：过期结论、
  无关片段、未经核实或被误当作事实的旧内容混入当前推理）
  - `README.md` 开头与 `SKILL.md` 开头各加宗旨说明；`SKILL.md` 的 `description` 同步补入，
    便于技能检索时命中"上下文幻觉/历史污染"这类诉求
- 补全 **MIT 许可证呈现**：README 顶部加 License/version 徽章，`## License` 一节给出完整 MIT 文本与
  版权行；`LICENSE` 文件与 `package.json` 的 `"license": "MIT"` 保持一致

## 2.3.0 — 2026-10-06

- 新增 **`references/porting-guide.md`（重塑指南）**：回答"宿主破坏性更新后能否依赖本规则重塑技能"
  - 三圈层模型：**核心圈（规则，不依赖宿主）／适配圈（胶水，需重写）／观测层（口径，需校准）**
  - 绑定点清单（7 项，逐条给出依赖符号 + 失效表现 + 探针检查名）
  - 重塑五步 + 验收标准 + "保持不变形"的四条前提 + 换 harness 的搬运建议
- 新增 **`scripts/probe-assumptions.cjs`（宿主漂移探针）**：逐条检查 15 项假设，输出 `PASS / DRIFT / SKIP`
  （本机实测：DSH 0.2.0-rc.2，15/15 PASS）
- `SKILL.md` §十一 增加"破坏性更新后先跑探针"的处置指引；版本 → 2.3.0
- `README.md`：新增 **「依赖与最小配置」**（三档最小配置 + 依赖矩阵 + 两条要点），
  并在**开头与结尾各加一段依赖提醒**；「兼容性」链接重塑指南

## 2.2.0 — 2026-10-06

- 新增 **L0/L1 成本归属**（§七.4–§七.6）：常驻骨架计入**固定开销**，动态召回计入**注入预算**；§一.7 同步更新
- 明确去重的边界：**去重只能消除"重复副本"，不能消除"那一份"**；给出"L0 ≤ 固定开销 30%"的经验阈值
- `scripts/measure-overhead.cjs` 升级：区分 **固定开销 / L0 骨架 / L1 动态召回** 三类成本，输出占比与每轮均摊
- `references/config-map.md` 新增「注入形态对照表」（通道、去重效果、成本形态、可实现性）
- `references/overhead-measurement.md` 重写：三类口径 + 实测样例 + **依据（References）**
- `README.md` 新增「参考与依据」章节：DSH 包、记忆插件对照、同主题项目、自测数据
- 实测（本机 2026-10-06）：自动召回全开的 66 轮会话，L1 累计 169,158 字符 ≈ **52,862 tokens**，
  占该会话上下文成本 **95%**（同会话固定开销仅 2,653 tokens）

## 2.1.0 — 2026-10-06

- **新增插件形态**：本仓库同时是标准 DSH 插件，可用 `dsh plugin add github:Kfytm/attention-scheduler` 一键安装
  - `package.json`：`dsh.bundle.patch` + `files`/`keywords`
  - `cordis.patch.yml`：bundle 挂载清单（insert 一行）
  - `lib/index.js`：零依赖插件半边，用 `ctx.skills.registerProvider()` 注册运行期技能（rank 250，
    低于用户本地文件技能 400，可被覆盖），并监听 `SKILL.md` 变化热刷新
  - 可选调试：`DSH_SKILL_PROBE=1` 时向 stdout 打印注册结果
- 文档：安装章节拆为"插件形态 / 文件技能形态"，新增 `lib/` 结构说明

## 2.0.0 — 2026-10-06

- 由"注意力调度规则 v1"整理为可分发的 DSH 技能（`SKILL.md` + `references/` + `scripts/`）
- **实测值替换假设值**：固定开销由 6000 改为实测 **12653** tokens
  （系统提示 8440 字符 ≈ 2638 + 42 个工具定义 32051 字符 ≈ 10016）
- 补入模型上下文窗口实测 **1,000,000** tokens
- 压缩触发阈值由"超出模型上下文"改为"超出上下文窗口 60%"
- 新增 `references/config-map.md`：区分"行为条款"与"机制参数"，标明配置落点
- 新增 `scripts/measure-overhead.cjs`：固定开销实测（可复现数字）
- 新增安装脚本（PowerShell / bash）与自检清单

## 1.0.0 — 2026-09

- 初版规则（保留轮次、工作记忆预算、检索触发、强制/禁止检索、跨会话检索、
  返回记忆数、记忆注入、冲突处理、长期记忆写回）
