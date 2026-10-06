#!/usr/bin/env pwsh
<#
.SYNOPSIS
  把本技能安装到 DSH 技能目录（Windows）。

.DESCRIPTION
  DSH 的技能扫描是 depth 1：必须是 <skills>/<skill-name>/SKILL.md，
  技能名须匹配 ^[a-z0-9]+(?:-[a-z0-9]+)*$。
  安装位置：$env:DSH_HOME\skills\<skill-name>（默认 %USERPROFILE%\.dsh\skills）。

.EXAMPLE
  pwsh -File scripts/install.ps1
  pwsh -File scripts/install.ps1 -Mode link      # 用目录联接，便于开发时实时生效
  pwsh -File scripts/install.ps1 -Force          # 覆盖已存在的安装
#>
[CmdletBinding()]
param(
	[string]$SkillName = 'attention-scheduler',
	[ValidateSet('copy', 'link')][string]$Mode = 'copy',
	[switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$skillsRoot = Join-Path $dshHome 'skills'
$target = Join-Path $skillsRoot $SkillName

if (-not (Test-Path (Join-Path $repoRoot 'SKILL.md'))) {
	throw "在 $repoRoot 下找不到 SKILL.md，请从仓库根目录运行本脚本。"
}
if ($SkillName -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') {
	throw "技能名不合法：$SkillName（须为 kebab-case）"
}

# 路径护栏：目标必须落在技能目录内，避免误删/误写其他位置
$resolvedRoot = [System.IO.Path]::GetFullPath($skillsRoot).TrimEnd('\')
$resolvedTarget = [System.IO.Path]::GetFullPath($target)
if (-not $resolvedTarget.StartsWith($resolvedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
	throw "拒绝操作：目标不在技能目录内（$resolvedTarget）"
}

New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null

if (Test-Path $target) {
	if (-not $Force) {
		throw "目标已存在：$target（加 -Force 覆盖）"
	}
	Remove-Item $target -Recurse -Force
}

if ($Mode -eq 'link') {
	New-Item -ItemType Junction -Path $target -Target $repoRoot | Out-Null
	Write-Host "已创建目录联接：$target -> $repoRoot"
} else {
	New-Item -ItemType Directory -Force -Path $target | Out-Null
	foreach ($item in @('SKILL.md', 'references', 'scripts', 'README.md', 'LICENSE', 'CHANGELOG.md')) {
		$source = Join-Path $repoRoot $item
		if (Test-Path $source) {
			Copy-Item $source -Destination $target -Recurse -Force
		}
	}
	Write-Host "已复制到：$target"
}

Write-Host ''
Write-Host '验证：'
Write-Host "  Test-Path '$target\SKILL.md'"
Write-Host '  # 期望输出 True；随后在 DSH 里技能列表会出现该技能（无需重启）。'
