# Agent Note: 技能可写入共享 agents 根，定时器提前触发的那一次仍然派发

Status: implemented

## 问题

技能中心会列出 `~/.agents/skills`（来源分组 `user-agents`，rank 500），但两个写入口都不支持：`create` 与 `import` 只接受 `root: "user"`（`~/.dsh/skills`）或 `root: "project"`（`.dsh/skills`），其余一律 400。想放进共享 agents 根，只能先建在别的根再手动搬目录，同一个面板的读路径与写路径对「有哪些根」各说各话（`#2094`）。

任务看板的调度定时器还有另一个独立缺陷：`HostTaskBoardService.onScheduleFire(target)` 取 `now = this.now()` 再向账本要该时刻到期的规则。原生定时器若比它被武装的目标早 1ms 触发，`dueSchedules(now)` 会跳过这次出现，随后的 `armSchedule()` 又用 `nextArmedRunAt(this.now())` 只接受严格未来的目标。于是规则留着已经过去的 `nextRunAt`，不再被武装、不记 missed，从此不再触发（`#2093`）。

## 决定

`create` 与 `import` 接受 `root: "agents"`，写入解析出的 agents home：`collect.ts` 在 `userSkillRoot` 旁边导出共享根约定 `agentsSkillRoot(agentsHome)`，两条路由都用读路径同一份 `SkillRoutesDeps.agentsHome` 解析。导入路由标注 `targetLevel: 'user-agents'`，因此现有的 `SKILL_SOURCE_RANK` 冲突裁决会把已被 `user-dsh` 根占用的同名候选报成 `shadowed`，把 agents 根内已有的同名报成 `exists`。

面板在创建与导入两个下拉里都提供第三个根，标签取自插件 zh/en 字典与 `dsh-i18n` 俄语字典中的 `create.root.agents` 键。

`onScheduleFire` 把「被武装的那个时刻」视为已覆盖：`const now = Math.max(this.now(), target)`。提前回调因此照常派发这次出现，并从目标时刻把 `nextRunAt` 滚动到下一个 cron 点；真正迟到时 `now - target > RECOVERY_TOLERANCE_MS` 仍成立，继续走既有的恢复路径。

## 测试

`packages/dsh-skill-explorer/tests/routes.spec.ts` 覆盖两条写入路径（文件落在解析出的 agents home、不落在 `~/.dsh/skills`）以及与 `user-dsh` 同名时的 `shadowed` 裁决。

`packages/dsh-task-board/tests/host-service.spec.ts` 覆盖提前触发的循环规则（一次执行、`nextRunAt` 滚到下一分钟、定时器重新武装）与超过恢复容差的触发（不执行、该次出现跳过）。把 `Math.max` 那一行改回原实现，提前触发用例即以 `expected "vi.fn()" to be called once, but got 0 times` 失败。

## 备选方案

**让 `root` 直接接受任意来源 level key，再从 `SOURCE_GROUPS` 反查目录。** 现在不采用：可写根与可扫描根不是同一个集合（loader 的自定义目录只读，注册表 level 没有可写路径），反查本身仍需要一份白名单；只放宽参数而不做这件事，只是把校验挪了个位置。

**把提前触发当成重新武装 `nextArmedRunAt(target)`，而不是钳制时钟。** 不采用：账本调用同时驱动 `openScheduled(taskId, now)`，其中跑量预算与 `triggeredAt` 属于这次要派发的出现。钳制让一次触发只有一个时钟，而不是同一时刻的两种写法。

**让 `nextArmedRunAt` 接受 `nextRunAt >= now`。** 不采用：没有武装的定时器遇到已到期规则会以零延迟重新武装并空转，而且恢复路径也用同一个判定来决定规则是否已经过期。

## 后果

列表、创建、导入三个面现在对可服务的根达成一致；`~/.agents/skills` 保持 rank 500，在那里创建的技能与列表既有行为一致，会被同名 `~/.dsh/skills` 技能遮蔽。

宿主时钟比目标早一点点的调度出现会被真正派发而不是被静默搁置。钳制不会把时钟往回拨，因此真正迟到与启动时的跳过路径行为不变。