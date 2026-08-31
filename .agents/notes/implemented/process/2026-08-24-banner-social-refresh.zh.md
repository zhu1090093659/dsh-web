# Agent Note: banner 重建与 social 预览图刷新

Status: implemented

## Problem

README 大标题仍是「dsh-web · DSH Web UI」，已提交的 banner（docs/dsh-web-banner.png）仍显示旧产品名「dsh-web-ui」「DSH Web UI」以及已移除或改名的功能徽章（实时令牌统计、皮肤中心）。这张 banner PNG 在仓库里没有对应源文件：scripts/banner/banner.html 生成的是另一套更旧的设计，图片无法可复现地再生成或修改。GitHub 社交预览图是同一张旧图的独立上传副本。

## Decision

- 根 README 双语对大标题改名：「dsh-web · DSH Web 插件聚合生态包」/「dsh-web · Aggregate Plugin Ecosystem for DSH Web」。
- 重写 scripts/banner/banner.html，在仓库内复现鲸鱼娘设计：blue-fantasy 皮肤原画（packages/skins/skin-center/skins/blue-fantasy/assets/whale-art.jpg）调暗作背景，左侧品牌区（眉行「The Plugin Ecosystem for DeepSeek Harness」、标题「dsh-web」、副标题「DSH Web 插件聚合生态包」、单行徽章列出当前功能：任务看板、Git 图谱、右侧面板、移动端远程、鲸鱼娘宠物、皮肤、创意工坊），右侧用 dsh-pet 鲸鱼娘精灵图 0,0 单元格做贴纸并加 CSS drop-shadow 描边。
- scripts/banner/shoot.mjs 现在产出两张图：docs/dsh-web-banner.png（1280x400，README 用）与 docs/dsh-web-social.jpg（1280x640，JPEG 以控制在 GitHub 1 MB 限制内）。
- GitHub 社交预览图需在仓库设置里替换为 docs/dsh-web-social.jpg；曾尝试用 ego-browser 自动上传，但浏览器卡在原生文件对话框，最后一步改为手动上传。

## Alternatives considered

- 用图像生成模型直接改图上文字：被否决；文字渲染不可靠，且仓库里模板与产物脱节的问题依旧存在。
- 保留旧的浏览器样机 banner.html 只换文案：被否决；它生成的设计与用户实际看到的 banner（鲸鱼娘原画）完全不同。

## Consequences

- banner 重新可复现：改 banner.html，跑 node scripts/banner/shoot.mjs，提交两张 PNG。
- 徽章行是唯一以图片形式列出功能的地方，主打功能集变化时需同步更新。
- 跟进：在 GitHub 仓库设置中上传 docs/dsh-web-social.jpg（社交预览），旧「dsh-web-ui」图才会停止展示。
