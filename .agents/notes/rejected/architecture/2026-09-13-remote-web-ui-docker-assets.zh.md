# Agent Note: 远程 Web UI 插件不提供容器资产

Status: rejected — 该插件不是可独立运行的服务，且本仓库无法验证容器产物

## Problem

issue #1538 希望仓库提供 `Dockerfile` 与 `docker-compose.yml`，以便在本地或服务器上部署远程 Web UI。

## Decision

仓库不提供容器资产。`dsh-remote-web-ui` 是 Cordis 插件，只能在官方 `@deepseek-ai/dsh` 宿主内运行，因此容器镜像打包的是上游宿主，而不是本插件。报告者在 issue 中拿到了一份可用配方（安装官方宿主、`dsh plugin --profile web add`、`dsh web --host 0.0.0.0`），随后该 issue 关闭。

## Alternatives considered

在仓库根目录提交 Dockerfile：否决。目录布局规则限制了顶层目录，而且这会把上游宿主的打包维护责任落到本仓库。

把同样的配方放进插件包内：同样否决。CI 与开发机都没有 Docker，产物既无法构建也无法验证，而一份钉在持续变化的上游上的未验证镜像定义会悄悄失效。

把配方写进插件包 README 仍然开放。若维护者希望仓库内保留一条容器路径，它应当落在远程访问文档里，并明确说明容器路线属于社区支持。
