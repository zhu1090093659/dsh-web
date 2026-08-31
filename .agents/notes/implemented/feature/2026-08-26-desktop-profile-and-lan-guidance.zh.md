# Agent Note: DSH 桌面版 Profile 安装文档与远程局域网指引

状态：已实现 (implemented)

## 问题背景

1. (#1180) 仓库主文档此前主要以 `--profile web` 与 `dsh web` 为例，使部分使用 DSH 桌面客户端（DSH Desktop）的用户误以为聚合包不支持桌面版或需要专用包。
2. (#1183) 在 Linux/SSH 无显示器服务器以 `--host 0.0.0.0` 启动服务时，终端缺少局域网可访问移动端地址的即时日志输出。

## 技术决策

1. 在主 `README.md`、`README.en.md` 以及 `packages/dsh-web-all/README.md`、`README.zh.md` 中，补充了面向 DSH Desktop 的推荐安装、验证与重启说明（`dsh plugin --profile desktop add @linxin666/dsh-web-all@latest`、`dsh --profile desktop --dump-config` 与重启客户端）。
2. 在 `packages/dsh-remote-web-ui/src/index.ts` 中，当存在可用局域网 IP 时，在启动阶段打印局域网移动端访问地址。

## 影响与收益

桌面端用户获得明确官方指导；在无头 Linux 服务器使用 SSH 启动时可一目了然获取局域网访问链接。

## 验证结论

`pnpm docs:check` 与 `pnpm --filter @linxin666/dsh-remote-web-ui test` 全绿通过。
