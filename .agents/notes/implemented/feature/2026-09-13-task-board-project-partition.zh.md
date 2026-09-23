# Agent Note: 任务看板项目分区

Status: implemented

## Problem

issue #1536 希望看板按 DSH 项目来用：在顶部选择项目、只看到该项目的任务，并且在新建任务时不必再选一次工作区。任务本身已经带有可选的 `workspaceId` 钉住字段，浏览器半区也已经注入了 `@deepseek-ai/dsh-api-workspace-controller`，但看板界面上一直没有「项目」这个概念。

## Decision

看板顶栏渲染一个项目行（语义部件 `project-filter`），选项来自 `executionOptions.workspaces`。空值表示全部项目；选定某个项目后，看板与归档视图都只显示 `workspaceId` 匹配的任务，没有钉住工作区的任务留在「全部项目」下。在某个项目下打开新建任务表单时传入 `defaultWorkspaceId`，把该项目预选为工作区，同时保持可修改。「新建项目…」展开一个内联的路径输入框（`project-dialog`），调用 `BoardController.createWorkspace`，由浏览器 apply 接到 `ctx.workspaces.create({ path })` —— 也就是 GUI 自身「添加项目」用的同一个运行时调用，因此看板与侧栏共享同一份项目列表。当部署既没有项目、也没有提供注册能力时，这一行整体隐藏。

## Alternatives considered

按 issue 原文在「全部项目」下强制选择工作区：否决。留空即「最近工作区」是既有且已文档化的行为，强制必填会让从不打开项目的用户每个任务都多一步。

按工作区路径而不是 id 过滤：否决。账本存的是 id，项目目录改名或移动不应该让任务脱离归属。

由看板自己维护一份项目登记表：否决。那会复制 DSH 的工作区列表并逐渐与之不一致。

## Consequences

没有钉住工作区的任务只在「全部项目」下可见，用户切到某个项目时可能会以为任务消失了；归档视图行为一致。工作区控制器服务现在不仅被读列表，还被用于写入，因此当部署拒绝注册时会话框会显示运行时给出的原因，而不是静默失败。两个新的语义部件值已登记到 `semantic-attrs-v1.md`。
