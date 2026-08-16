- 提交信息遵循 Conventional Commits（如 `fix(task-board): 修复 xxx`），代码、文档与提交信息全程禁止 emoji。
- 新插件与皮肤用脚手架生成：`node scripts/dsh-plugin-new <name>`、`node scripts/dsh-skin-new`。
- 提交前过门禁 `pnpm typecheck && pnpm test && pnpm docs:check`；完整开发流程见 [docs/development.md](docs/development.md)。

## 许可证

本仓库以 [Apache-2.0](LICENSE) 授权。迁入第三方代码必须保留 LICENSE 与署名；活跃且有上游的第三方优先 fork 或依赖引用，不搬代码。

### 来源与版权

| 包 | 来源 | 版权 |
| --- | --- | --- |
| dsh-task-board / dsh-git-graph / dsh-aionui-panel / dsh-pet / dsh-remote-web-ui / dsh-live-stats / dsh-web-ui-settings / dsh-liangshen / dsh-skins / dsh-web-ui-all / dsh-shutdown / skins | 作者 zhu1090093659 个人开发 | Apache-2.0（zhu1090093659） |
| dsh-tool-describe-image | 移植自 [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)（deepseek-harness `packages/vision/tool-describe-image`） | Apache-2.0（zhu1090093659） |

## 贡献者

<p align="center">
  <a href="https://github.com/zhu1090093659/dsh-web-ui/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=zhu1090093659/dsh-web-ui" alt="Contributors">
  </a>
</p>

<div align="center">
