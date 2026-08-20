# 公共端点 deepseek-v4-pro 图片输入实测与目录修正（2026-08-20）

冻结记录一次运行失败的定位与修复证据。历史快照，不修改长期文档。

## 现象

profile web 上一个 deepseek-v4-pro（Max 推理档）会话在 read_image 注入图片后整轮失败：INVALID_REQUEST，服务端报 messages[N]: unknown variant `image_url`, expected `text`。重试与「继续处理」均复现。

## 根因

rc.8 升级验收（见 [2026-08-19-sdk-rc8-upgrade-validation.md](2026-08-19-sdk-rc8-upgrade-validation.md)）把 llm-deepseek 目录中 deepseek-v4-pro 的 inputModalities 写为 [text,image] 并保持启用，但当时只验证到「写入目录 -> verdict 翻转」，未验证真实图片请求闭环。

2026-08-20 对官方公共端点 https://api.deepseek.com 的 /chat/completions 直接探测（1x1 PNG data-URL，max_tokens 1）：deepseek-v4-pro 与 deepseek-v4-flash 均返回同一 INVALID_REQUEST（content part 枚举仅允许 text），即公共部署当前不接受图片输入。rc.8 的原生图片请求是适配器侧的按目录声明启用能力（另含 $DEEPSEEK_BASE_URL 内部端点通道与 maxRequestImageBytes 默认 20 MiB 的历史图片卸载），目录声明必须与目标部署实况一致。

## 处置

- ~/.dsh/settings.yaml 中 deepseek-v4-pro 的 inputModalities 改回 [text]（改前备份 settings.yaml.bak-v4pro-textonly-20260820090806），目录重新与公共端点实况一致。
- 生效后行为：read_image 在该模型会话工具侧快速拒绝（明确报错，不再污染历史）；describe_image 工具重新对该模型可见；贴图发送恢复改写为 describe 引用。
- 端点日后开放图片输入时，经设置卡「原生图片请求」开关重新写回 [text,image] 即可原生收发，无需改代码。

## 已知残留

- 已污染会话（历史中已含图片块）重试会在适配器侧以 UNSUPPORTED_CONTENT 快速失败；该会话需切到真实支持图片的模型或新开会话经 describe_image 分析图片。
- describe-image 插件的路由 verdict 缓存（成功 10 分钟 TTL）只经插件自身开关失效；直接编辑 settings.yaml 后，verdict 探测最坏沿用旧值 10 分钟，适配器本体按请求读取设置、不受该缓存影响。
