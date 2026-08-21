# Wallpaper Exclusive

English | [中文](README.zh.md)

A wallpaper-first skin for the DeepSeek Harness web GUI. The default official
base is kept, and the surfaces that float over the wallpaper — the input card,
message bubbles, code blocks, inline code, settings cards, plugin panels, the
skill center and the task list — are frosted with liquid glass so the Wallpaper
Engine video shows through. The skin ships a built-in default wallpaper
(`whale-art-v2.png`) that is used only when no Wallpaper Engine wallpaper is
selected; otherwise the WE wallpaper is the backdrop.

## What it does

- Wallpaper-first: the WE wallpaper is the backdrop; nothing opaque is drawn
  over it.
- Liquid glass everywhere: input card, user bubble, code block, inline code,
  settings surface, plugin panels, sidebar keys (新会话 / 任务看板 / ssh /
  技能中心) and session/workspace cards, the top-bar subagent board, bottom
  panel chrome, composer `+`/`/` menus, skill-center panel, git-graph chips,
  ssh panel chrome, the queued-send card, and the task-board columns and cards.
- Fixed frosted glass: every non-input-card surface uses a fixed
  semi-transparent frosted material; the input card itself follows the web-ui
  unified design.
- Built-in default wallpaper: `whale-art-v2.png` is bundled and shown when no
  WE wallpaper is selected.
- Light and dark: full dual-theme token sets for both GUI modes.

## Install

Select **Wallpaper Exclusive** in 设置 → 皮肤中心 → 皮肤, with a Wallpaper
Engine wallpaper applied and enabled in the skin-center wallpaper panel.

## Frosted glass (scope)

The input card is owned by the web-ui unified design; this skin does not
override it. Every other floating surface uses a fixed semi-transparent frosted
material with the skin variables `--dsw-wallpaper-glass-blur` and
`--dsw-wallpaper-glass-fill`. No slider drives these surfaces.

The frost strength is fixed at 10px; the glass fill opacity is a fixed skin
value, `--dsw-wallpaper-glass-fill`.

## Known limitations

- The input card is left to the web-ui unified design and is not part of this
  skin's fixed glass set.
- Frosting is `backdrop-filter` based; very heavy GPU usage can occur when many
  glass layers are stacked at high blur.
- The conversation area keeps the official default look; the skin does not
  force it solid or glass (matching the global skin-center design).
