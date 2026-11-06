# DIY Journal

[中文说明](README.zh.md)

A paper-and-tape journal skin for DeepSeek Harness. Version 1.14.2 includes 14
ChatGPT-generated Whale-chan illustrations, handwritten headings, an address-book
remote-access dialog, notebook settings pages and light/dark palettes.

## Install

Copy this directory to `$DSH_HOME/skins/diy-journal` (default:
`~/.dsh/skins/diy-journal`), then select **DIY Journal** in Settings > Skins.
The release contains generated assets and needs no Python or build step to display.
Back up an existing DIY skin before replacing it. Other skins are unaffected.

## Optional photo editor

Install the separate [DIY Journal settings plugin](https://github.com/Alphazerolan/diy-journal-settings).
It adds Settings > DIY Journal and requires Python 3.9+ on Windows. It supports
photo selection, layouts, tape color/pattern, position, rotation, scale, borders,
captions, two-photo ordering and scene previews. Personal images stay local.
No-photo areas collapse. The skin remains usable without this plugin.

## Source and character credits

This skin depicts **DeepSeek 鲸鱼娘（大肥鱼）/ Whale-chan**, a fan character, with the following credits:

- **Original character design:** [上善](https://www.pixiv.net/users/62155430), the whale-girl character.
- **DeepSeek maid redesign:** [ZipZipPipe](https://www.pixiv.net/users/18604994), the maid interpretation incorporating DeepSeek elements, generated with GPT Image 2.
- **This skin:** [Alphazerolan](https://github.com/Alphazerolan/diy-journal-skin), who generated 14 separately themed illustrations with ChatGPT on 2026-10-21 and created the journal layout, decoration and skin integration.

This is an unofficial fan work. Character-design rights remain with the respective creators;
character redistribution permission has not been independently verified.
See [NOTICE](NOTICE) for attribution sources and license scope, and [ARTWORK.json](ARTWORK.json)
for illustration themes and hashes. Fonts retain their OFL licenses. Reference-video frames,
illustration files from other skins and personal photos are not bundled.

The illustrations and character artwork bundled with this skin are for personal, non-commercial use only. Character and other third-party rights remain with their respective holders; this notice grants no third-party rights or official authorization.

## Compatibility and limits

Skin manifest v2, optional SkinHooks v1alpha1. The host only executes approved
market hooks; local copies may display CSS without optional state enhancements.
Some layout rules match current Harness classes and can require updates after
Harness UI changes. The editor runs a token-protected loopback-only service and
closes after 20 minutes idle. Workshop acceptance is still subject to review.

## Remove

Select another skin, then remove this skin directory. Uninstall the companion
plugin separately; its personal editor workspace is retained for recovery.
