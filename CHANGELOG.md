# Changelog

本文件记录本技能的规则版本。规则语义变更请递增 minor，措辞/错别字修正用 patch。

## 2.1.0 — 2026-10-06

- **新增插件形态**：本仓库同时是标准 DSH 插件，可用 `dsh plugin add github:<user>/attention-scheduler` 一键安装
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
