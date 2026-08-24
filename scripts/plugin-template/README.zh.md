# @linxin666/dsh-client-ui-__NAME__

[English](README.md) | 中文

DSH Web GUI 插件 __NAME__ —— 由 scripts/plugin-template 生成的骨架。插件实现
完成后把本文件替换为真实说明。

## 是什么

<!-- 描述插件：新增哪个侧边栏入口、在 Web GUI 中做什么。 -->

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-__NAME__@latest
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/__NAME__
```

## 已知限制

<!-- 如有已知限制，列在这里。 -->

## 许可证

BSD-3-Clause。
