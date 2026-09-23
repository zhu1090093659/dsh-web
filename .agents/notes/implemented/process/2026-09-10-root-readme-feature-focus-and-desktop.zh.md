# Agent Note: 根 README 的功能收敛与 DSH Desktop 章节

Status: implemented

## Problem

根 README 展示了默认家族安装并不携带的三个界面：梁神模式与救助模式是出厂默认关闭的可选行（`aggregate.yml` 的 `inactive`），外部归档管理则完全没有随包分发。它们的功能章节、单独安装命令、npm 包行与来源登记都在宣传一次全新安装不会加载的能力。同一份文档里，本仓库自己的 Electron 桌面应用（内置运行时与全家桶的可安装 macOS / Windows 构建）只有「快速上手」中的三步说明，而那条说明让读者执行 `dsh plugin --profile desktop add @linxin666/dsh-web-all@latest`。应用从不读取 `desktop` profile：它播种并运行的是 `$DSH_HOME/profiles/web`，因此该指引安装进了一个应用不使用的 profile。

## Decision

- 从 `README.md` 与 `README.en.md` 删除梁神模式与救助模式的功能章节、各自的单独安装命令、npm 包行与来源登记，并从原创插件署名清单中去掉 `dsh-doctor`。
- 从「更多插件」删除外部归档管理条目；会话归档由内置的会话归档管理承担。
- 把会话归档管理（`dsh-session-archive`）呈现为一等功能插件：保留 `### 会话归档管理` 章节，新增能力表行、npm 包行、单独安装命令，并进入开篇插件清单。
- 双语 README 在「是什么」与「创意工坊」之间新增顶层 `## DSH Desktop（桌面客户端）` 章节，覆盖内置 Node 运行时、独立的 3082-3181 宿主端口段、带标记重新播种的共享 `~/.dsh`、应用内插件管理、启动错误页与未签名安装包的限制，并链接 `desktop/README.zh.md` / `desktop/README.md`。
- 「快速上手」的桌面条目改为下载即用路径（GitHub Release 的 `dsh-desktop-*` 资产），「从旧聚合包升级」改为描述插件管理器更新检查实际执行的事务迁移（`legacyMigrationFor` → `gateway.migrate`，可回滚并带 `--dump-config` 预检），不再依赖 Doctor 启动器预检。

## Alternatives considered

- 只删除三个主题的正文、保留安装命令、npm 行与来源登记：否决——README 仍会呈现默认家族不加载的插件，正是本次要消除的误导。
- 保留 Doctor 启动器的旧聚合迁移说明：否决——救助模式出厂默认关闭，照做需要先启用插件；插件管理器的更新作业在默认安装下完成同一套迁移。
- 整节删除「从旧聚合包升级」：否决——仍挂在 `@linxin666/dsh-web-ui-all` 的 profile 需要迁移入口，插件管理器路径对它们成立。
- 把桌面应用写成插件行或能力表条目：否决——它是整套家族的发行形态（自带宿主的 Electron 壳），不是可挂载的行。

## Consequences

- 根 README 不再出现梁神模式、救助模式与外部归档管理。它们的事实归属不变：`packages/dsh-liangshen` 仍在包内保留 MIT preset 声明，`packages/dsh-doctor` 仍保留自己的 README。
- 安装桌面应用的读者改走 Releases 下载路径，不再执行会落到应用不使用的 profile 上的 `--profile desktop` 命令。
- 本次再次部分取代 [精简根 README 并将资产发现归于创意工坊](../simplification/2026-08-24-root-readme-workshop-simplification.zh.md)，并反转已归档的 [根 README SEO 优化与特色功能章节](../../archived/process/2026-08-25-root-readme-seo-feature-sections.zh.md) 的一部分；SEO 优化留下的关键词覆盖仍然有效。
- 根 README 中英保持结构镜像；`docs:check` 使用的结构签名比对报告两侧一致。

## Testing

- `pnpm docs:check` 通过。
- 用 `scripts/verify-docs.mjs` 的 `signature`/`sigEqual` 比对 `README.md` 与 `README.en.md`：结构一致，且两侧全部相对链接在磁盘上可解析。
- 对两个文件全文 grep，已删除主题无残留命中。
- 新章节的安装包说法已对照 v0.3.20 GitHub Release 资产核验（`dsh-desktop-0.3.20-mac-arm64.dmg`、`-mac-x64.dmg`、`-win-x64.exe` 及 zip 变体）。
