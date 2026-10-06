#!/usr/bin/env bash
# 把本技能安装到 DSH 技能目录（macOS / Linux / WSL）。
#
# DSH 的技能扫描是 depth 1：必须是 <skills>/<skill-name>/SKILL.md，
# 技能名须匹配 ^[a-z0-9]+(?:-[a-z0-9]+)*$。
#
# 用法：
#   bash scripts/install.sh                 # 复制安装
#   bash scripts/install.sh --link          # 建立符号链接（开发时实时生效）
#   SKILL_NAME=my-skill bash scripts/install.sh
set -euo pipefail

SKILL_NAME="${SKILL_NAME:-attention-scheduler}"
MODE="copy"
FORCE="0"

for arg in "$@"; do
	case "$arg" in
		--link) MODE="link" ;;
		--force) FORCE="1" ;;
		*) echo "未知参数: $arg" >&2; exit 2 ;;
	esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
SKILLS_ROOT="$DSH_HOME/skills"
TARGET="$SKILLS_ROOT/$SKILL_NAME"

[[ -f "$REPO_ROOT/SKILL.md" ]] || { echo "在 $REPO_ROOT 下找不到 SKILL.md" >&2; exit 1; }
[[ "$SKILL_NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "技能名不合法: $SKILL_NAME" >&2; exit 1; }

mkdir -p "$SKILLS_ROOT"

if [[ -e "$TARGET" ]]; then
	if [[ "$FORCE" == "1" ]]; then rm -rf "$TARGET"; else
		echo "目标已存在：$TARGET（加 --force 覆盖）" >&2; exit 1
	fi
fi

if [[ "$MODE" == "link" ]]; then
	ln -s "$REPO_ROOT" "$TARGET"
	echo "已创建符号链接：$TARGET -> $REPO_ROOT"
else
	mkdir -p "$TARGET"
	for item in SKILL.md references scripts README.md LICENSE CHANGELOG.md; do
		[[ -e "$REPO_ROOT/$item" ]] && cp -R "$REPO_ROOT/$item" "$TARGET/"
	done
	echo "已复制到：$TARGET"
fi

echo
echo "验证：test -f \"$TARGET/SKILL.md\" && echo OK   # 期望 OK；随后 DSH 技能列表中会出现该技能（无需重启）"
