# AGENTS.md — marketing/

本目录存放 dsh-web 的宣传片工程：项目对外展示用的视频素材、工程文件与成片，在本机生成，不进版本库。片子内容与仓库代码互不影响。

## 目录结构

一个片子一个子目录，目录名即片子标识；工程内的设计稿、脚本与素材都留在该子目录里，不散落到仓库其他地方。

## 版本控制

- 片子目录逐条写进根 [.gitignore](../.gitignore)，格式为 `/marketing/<片子>/`；新增片子时补一行，成片与素材不进仓库。
- `marketing/` 本身不在忽略范围内，所以本文件这类目录级规则正常入库。
- [.oxlintrc.json](../.oxlintrc.json) 的 `ignorePatterns` 已含 `marketing/`，本目录的脚本不参与仓库 lint。

## 边界

片子改动不触碰 `packages/`、`market/`、`docs/`，也不进发布产物；仓库内的界面截图归 `docs/screenshots/`，与这里无关。
