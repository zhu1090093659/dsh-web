# Agent Note: 宠物亲密度等级国际化与语音包 Remarks / Ranks 覆盖支持

状态：已实现 (implemented)

## 问题背景

在 `dsh-pet`（#1226）中：
1. 英文环境下（如 `lang="en"`），宠物的 9 级亲密度 rank 名称（幼鲸 → 鲸生共渡）为中文写死，悬浮面板中亲密度等级未完成国际化；
2. 全局与独立语音包（`voice.json` / `.voice.json`）缺少 `remarks`（抚摸/喂食气泡反应库）与 `ranks`（等级名称表）顶级槽位，无法统一配置多语言台词与专属称号。

## 技术决策

1. 在 `affinity.ts` 中定义并导出 9 级亲密度等级的英文对照表 `AFFINITY_RANKS_EN`；
2. 在 `locales.ts` 中为中英文字典补充 `pet.rank.name.<tier>` 词条映射；
3. 在 `PetSprite.tsx` 中通过字典对等级名称进行本地化解析后再格式化输出；
4. 在 `voice-pack.ts` 与 `voice-pack-v1.schema.json` 中将 `remarks` 与 `ranks` 加入白名单和 JSON Schema，并在 `normalizeVoicePack` 与 `mergeVoicePacks` 中实现分层合并；
5. 在 `remarks.ts` 与 `ledger.ts` 中支持 `RemarkPicker` 和 `PetLedger` 消费语音包层级的 `voiceRemarks`。

## 影响与收益

- 英文语言环境下宠物亲密度等级正常显示为英文（如 "Affinity Baby Whale"）；
- 语音包支持通过 `remarks` 和 `ranks` 字段全局定制抚摸/喂食台词池与等级名称。

## 验证结论

在 `voice-pack.test.ts`、`remarks.test.ts` 和 `PetSprite.test.tsx` 中补充了单测。`dsh-pet` 452 项测试全部通过。