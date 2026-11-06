# DIY 手账本

[English](README.md)

适用于 DeepSeek Harness 的纸张、胶带和手绘风皮肤。1.14.2 包含 14 张
ChatGPT 生成的鲸鱼娘配图、手写标题、电话簿远程访问窗口和浅色／深色配色。

## 安装

把本目录放入 `$DSH_HOME/skins/diy-journal`，默认位置是用户目录下的
`.dsh/skins/diy-journal`，然后在“设置 → 皮肤”选择“DIY手账本”。
发布包已包含生成好的素材，只显示皮肤不需要 Python，也不需要构建。
替换已有 DIY 皮肤前请备份；其他皮肤不受影响。

## 可选样式菜单

另行安装 [DIY 手账本设置插件](https://github.com/Alphazerolan/diy-journal-settings)，
即可在“设置 → DIY 手账本”打开菜单。Windows 下需要 Python 3.9 或更新版本。
支持自选图片、布局、胶带颜色与纹样、位置、倾斜、缩放、宽窄白边、题字，
以及双照片顺序与遮挡关系、场景预览。不设置照片时收起图片区。个人图片仅保存在本机。
不安装插件仍可正常使用默认皮肤。

## 素材及角色声明

本皮肤使用 **DeepSeek 鲸鱼娘（大肥鱼）/ Whale-chan** 二创形象，署名如下：

- **原始角色设计：** [上善](https://www.pixiv.net/users/62155430)，鲸鱼娘形象。
- **DeepSeek 女仆再设计：** [ZipZipPipe](https://www.pixiv.net/users/18604994)，加入 DeepSeek 元素的女仆形象，使用 GPT Image 2 生成。
- **本皮肤制作：** [Alphazerolan](https://github.com/Alphazerolan/diy-journal-skin)，于 2026-10-21 使用 ChatGPT 分别生成 14 张主题配图，并完成手账本布局、装饰及适配。

本项目为非官方二创，角色设计权利归相应创作者；角色再分发授权尚未独立核实。
署名来源和授权范围见 [NOTICE](NOTICE)，逐图主题与哈希见 [ARTWORK.json](ARTWORK.json)。
字体保留各自的 OFL 授权。发布包不包含参考视频画面、其他皮肤的插画文件或个人照片。

本皮肤随附的插画及角色画面仅限个人非商业使用；角色及其他第三方权利仍归相应权利人，本声明不授予第三方权利或官方授权。

## 兼容性与限制

采用 v2 皮肤格式和可选 SkinHooks v1alpha1。只有经过市场审核的钩子才由宿主执行，
本地安装可能只加载 CSS，部分状态增强不启用。部分布局依赖当前 Harness 界面结构，
应用升级后可能需要适配。样式菜单仅在本机运行，带随机令牌，闲置 20 分钟自动退出。
创意工坊是否收录仍需维护者审核。

## 卸载

切换到其他皮肤后移除本皮肤目录。配套插件需单独卸载；编辑器个人图片目录保留供恢复。
