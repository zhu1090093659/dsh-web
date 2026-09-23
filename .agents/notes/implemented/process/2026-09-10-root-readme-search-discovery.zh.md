# Agent Note: 根 README 搜索发现优化

Status: implemented

## Problem

根 README 在图片徽章之后才介绍项目，且开篇段落冗长、宣传性较强。寻找 DSH 插件、主题、远程访问或桌面应用的读者需要简洁的说明和直接入口。

## Decision

两份根 README 在横幅前放置事实性摘要，标题明确插件与主题，并通过场景表格链接到功能归属文档。图片替代文本说明产品与界面。已有章节锚点及安装命令保持不变。

[功能收敛决策](2026-09-10-root-readme-feature-focus-and-desktop.zh.md)继续有效：本次仅调整内容呈现，不改变重点功能或资产归属。

## Alternatives considered

不采用关键词列表及重复宣传语，改用实际功能的自然描述。不添加 HTML 元数据或结构化数据脚本，因为仓库 Markdown 无法控制 GitHub 页面元数据。

## Consequences

保留 README.md 中文、README.en.md 英文的约定。根文档不在包级配对生成器范围内，因此验证需要显式比对结构并检查本地链接与锚点。本次改善内容清晰度；搜索收录和排名属于外部结果，不属于已验证效果。
