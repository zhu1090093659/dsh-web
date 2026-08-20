English | [中文](README.zh.md)

# Wallpaper Exclusive

A wallpaper-first skin for the DeepSeek Harness web GUI. The default official
base is kept, and the surfaces that float over the wallpaper — the input card,
message bubbles, code blocks, inline code, settings cards, plugin panels, the
skill center and the task list — are frosted with liquid glass so the Wallpaper
Engine video shows through. The skin paints no background of its own.

## What it does

- Wallpaper-first: the WE wallpaper is the backdrop; nothing opaque is drawn
  over it.
- Liquid glass everywhere: input card, user bubble, code block, inline code,
  settings surface, plugin panels, sidebar plugin entries, composer `+`/`/`
  menus, skill-center panel, git-graph chips, and the task-board columns and
  cards.
- Slider-driven blur: every glass surface is driven by the card-blur slider on
  the skin-center wallpaper panel.

## Install

Select **Wallpaper Exclusive** in 设置 → 皮肤中心 → 皮肤, with a Wallpaper
Engine wallpaper applied and enabled in the skin-center wallpaper panel.

## Card-blur slider (scope)

The 卡片背景模糊 (card background blur) slider on the skin-center wallpaper panel
writes the CSS variables `--dsw-wallpaper-glass-blur` and
`--dsw-wallpaper-glass-fill` onto the page. **Only this skin consumes those
variables**, so the slider has a visible effect only while Wallpaper Exclusive
is the active skin and a wallpaper is selected. Under any other skin the
variables are still written but nothing renders differently.

The slider controls the frost strength (0-20px); the glass fill opacity is a
fixed skin value, `--dsw-wallpaper-glass-fill`.

## Known limitations

- The 卡片背景模糊 slider only affects this skin (see above).
- Frosting is `backdrop-filter` based; very heavy GPU usage can occur when many
  glass layers are stacked at high blur.
- The conversation area keeps the official default look; the skin does not
  force it solid or glass (matching the global skin-center design).
