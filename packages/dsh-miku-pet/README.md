# miku-pet —— Miku 桌宠(DeepSeek Harness Web UI 插件)

> 一个只属于 Miku 的浮动桌宠插件:手绘风帧动画 + 桌面宠物玩法,与内置 dsh-pet 兼容共存。
> 本包只包含 Miku 自己的形象与功能。

## 功能特性

- **Miku 专属帧动画**:待机(停止)、挠头、眨眼 ×2、吃饭、拖拽、摔倒→站起(standup)、工作/成功/失败
- **随机待机(桌面版同款规则)**:待机时每 5 秒掷骰一次,60% 概率演一个随机动作(挠头/眨眼/吃饭),
  连续 2 次没抽中 → 下次必演(保底);由 `config.jsonc` 权重驱动(idle 40 / 小动作 36 / 吃饭 24)
- **拖拽**:按住拖动循环播放拖拽姿势;松手播一次"摔倒→站起"再回待机
- **点击互动**:单击宠物随机回应眨眼/挠头并弹出对应台词气泡;随机动作播放时也按动作弹气泡
- **连续工作 + 钱包**:悬停菜单「工作」→ 每 10s 判定一轮(50% 成功 +3 金币 / 50% 失败 -1,余额下限 0),
  不被打断就一直循环;「商店」购买食物恢复饥饿(金币不足拒绝,属性 0-100 夹取)
- **左侧属性彩条(悬停显示)**:饥饿值 / 心情值 / 活力值(0-100,橙/粉/绿);饥饿每 60s 衰减(平时 -1、工作 -5)
- **两级悬停菜单**:一级列按钮(改名/钱包/商店/工作),点击进二级或直接执行;名字存 localStorage
- **独立命名空间**:路由前缀 `/miku-pet/*`、entry id `miku-pet`,与 dsh-web-ui 内置
  dsh-pet(`/pet/*` + `/api/pet/*`)共存无冲突
- 双主题适配:菜单/商店/彩条恒为白底黑字(高特异性覆盖,免疫 GUI 皮肤)
- 运行时零 LLM/API 调用

## 安装

```sh
# 构建(esbuild 双入口 → lib/)
npm install
npm run bundle

# 安装进宿主(以 dsh CLI 为例)
dsh plugin --profile web add <本包路径或 miku-pet>
# 然后在 ~/.dsh/profiles/web/cordis.patch.yml 写入(HMR,保存即生效):
#   - insert:
#       - id: miku-pet
#         name: 'miku-pet'
```

- 改动后:`npm run bundle` → 浏览器硬刷新(Ctrl+Shift+R)
- host 代码(`lib/index.js`)改动需重启 dsh web;client bundle 改动即时按文件下发

## 配置(`assets/config.jsonc`)

```jsonc
"animationWeights": { "idle": 40, "turn": 0, "move": 0 },   // categories 合计 60 = 60% 演
"categories": [
  { "id": "小动作", "weight": 36, "actions": ["scratch", "blink1", "blink2"] },
  { "id": "吃饭",   "weight": 24, "actions": ["eat"] }
],
"phrases": { "scratch": ["…"], "blink1": ["…"], "blink2": ["…"], "eat": ["…"],
             "success": ["…"], "fail": ["…"] }
```

权重/台词都只改这个文件,不用动代码。新动作素材放入 `assets/thumb/<动作>/`(帧命名
`名字_帧号_毫秒.png` 可解析时长,宽松命名按末尾数字排序、默认 200ms),并按玩法加进
`config.jsonc` 对应池(categories/clicks/standup 等)。

## 兼容注意事项

- 与 `@linxin666/dsh-web-ui-all`(内置 dsh-pet)共存:不要把 entry id / 路由前缀改回
  `pet` 或 `web-ui-*`
- 配置/帧请求带缓存破坏参数,素材更新后刷新即生效

## 许可

MIT(仅含 Miku 素材与代码;素材版权归作者本人所有)