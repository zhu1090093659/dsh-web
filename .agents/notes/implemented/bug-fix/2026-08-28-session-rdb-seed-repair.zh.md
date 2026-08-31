# Agent Note: session-rdb 存储种子修复（表面坐标误解析）

Status: implemented

## 问题

线上宿主加载 `session-e85b346e-7cb9-4f5c-b090-d86aca5b83ad` 的历史失败：

```
history unavailable for session "session-e85b346e-…": SessionPersistenceCorruptionError:
stored session … failed validation: Error: invalid seed event at index 5074:
surface replace: sourceEventSeqs must include every shadowed surface node; missing 2930, 3432 (internal)
```

`web` profile 当前 opt-in 了 better-session 栈：聚合包以 insert 行引入 `@morlay/session-rdb`（SQLite 持久化，v0.0.11——也是 npm 最新版），profile 托管块禁用官方 jsonl 行、启用 rdb 行。出错会话只存在于该库（无 legacy jsonl），损坏在 rdb 存储数据里；全库复刻扫描发现 **512 个会话中 6 个**种子校验失败——报错的这个，外加五个打开时会以 `tool/result surface replacement` 错误静默失败的会话。

根因（在外部引擎的读路径，不在 dsh-web 代码）：rdb 写入路径把 `surfaceOp` replace 区间与 `sourceEventSeqs` provenance 存成**上游（host）seq 坐标**，读取路径用启发式（`resolveProvenanceSeq`："存储的 f_sequence 优先"——当该值在 dense 空间里恰好是更早的 surface 节点时按 dense 解释）把每个存储值解析到**稠密持久化 seq 空间**。两类碰撞击穿它：

1. **dense 碰撞**：存储的上游引用值恰好也是更早的某个 dense surface 节点值，被读成那个 dense 节点而非做上游→dense 映射。例（session 2840ba5e）：tool/result 重写存储 `{start: 308, end: 308}` 意指上游节点 308（dense 36）；dense 308 恰好是另一个 tool/result（callId 不同），重写便命中错误节点，"may change only content" 检查拒绝。
2. **resume 边界的重复上游 seq**：resume 的会话把父会话种子行与子会话重新编号的行存在同一日志，一个上游 seq 对应两行；`buildSeqMap` 首现优先。session e85b346e 引用上游 19628 意指子段 tool/result（dense 3432），首现优先却解析到父段 tool/call（dense 297）。

引擎自身的缓解无法挽回：`readPrefix` 在重映射后跑 `normalizeSurfaceReplaceProvenance`，但它按 **seq 区间**（`candidate.seq >= start && candidate.seq <= end`）合并候选，而遮蔽是**位置性**的——替换折叠后，窗口位置内可以存在 seq 值落在窗口外的存活节点（dense 2930/3432 位置上在 [3527..5065] 窗口内、seq 值却在窗口下方），合并漏掉它们；而 `cleanseSession` 会把同样误解析的读取结果持久化（"对已清洗数据解析恒为恒等"），等于把损坏坐标转正而非修复。

## 决策

以折叠状态算出的真值修复存储数据，并以官方校验器本身作为验收 oracle：

- **tool/result 重写（5 个会话）**：真目标语义无歧义——当前表面状态中与替换事件同 `toolCallId` 的节点（每例恰好一个候选）。把存储 `f_surface_op` 改写为 dense 目标、`f_source_event_seqs` 改写为 `[目标]`。写入值都是小于引用事件的 dense surface seq，读取启发式对其恒为恒等。
- **一般 replace 的 provenance（session e85b346e）**：保留（解析正确的）op 窗口，把存储 provenance 改写为"位置性遮蔽集（按服务坐标折叠计算）∪ 服务引用中的 surface 节点"——589 个遮蔽节点，全是 dense surface 值，读取恒等。
- 以单个守卫事务应用到实际库（每行仅在旧值仍匹配时更新），此前先在副本上完整演练。备份：`~/.dsh/backups/manual-seed-repair-<stamp>/`（沿用 bsm 的备份约定）。
- 验收 oracle：忠实复刻引擎读路径（rowToEvent 重映射 + readPrefix 的 normalize）加上官方 `dsh-session` 种子折叠，对独立快照的**全部 512 个会话**运行——修复前 506 通过，修复后 **512/512 通过**。

## 落选方案

- **升级引擎**：拒绝——0.0.11 已是 npm 最新（2026-08-27 发布），缺陷就在其中。
- **运行引擎自带的 `cleanseSession`**：拒绝——它会把误解析的读取结果持久化，等于把损坏坐标转正而非修复。
- **从 legacy jsonl 恢复**：不可用——六个会话没有 legacy 来源（迁移后的活跃会话或源已删除）。
- **停用 better-session 并重迁移**：拒绝——会丢掉六个会话仅存于 rdb 的历史，且为一个数据 bug 改变用户的存储后端。
- **手改事件 payload**：拒绝——只动了 surface 元数据列；事件数据行字节未动。

## 后果

- 当前引擎下全部 512 个存储会话可加载；六个修复会话经加载器同款读路径校验通过。
- 写入值是 dense 坐标，而所在行其他字段可能仍是上游坐标；引擎的逐值解析能处理这种混排（全库校验证明）。未来引擎升级若改变解析语义，应先用同一折叠 oracle 验证再部署。
- 启发式缺陷本身仍在上游（@morlay/session-rdb）：无段感知的 dense 优先解析、跨 resume 边界的首现优先映射、按 seq 区间而非位置补全 provenance。已带诊断与修复方案报给上游；上游修复前，以同样方式碰撞的 resume 会话仍会失败，需要同样的单次修复。

## 验证

- 复刻重现：从存储行出发逐字节复现出错种子事件与报文（`missing 2930, 3432`）。
- 修复前全库扫描：512 会话，6 失败（1 个 provenance 覆盖、5 个 tool/result 目标错）。
- 副本演练：应用 6 处修复，512/512 通过。
- 实际库应用：守卫通过（无并发行变更），单事务更新 6 行；对新取独立快照的修复后校验：**512/512 通过**。
- 备份保留于 `~/.dsh/backups/manual-seed-repair-<stamp>/`（db + wal + shm）。
