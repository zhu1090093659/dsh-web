/**
 * 桌宠配置管理设置页（settings.section 插槽，id: pet-config）
 *
 * - 多开：管理多个桌宠，每个宠物独立 id/size/位置（corner + marginX/Y）
 * - 数据流：设置页持有「合并后的完整宠物列表」→ 保存时全量 PUT /miku-pet/config
 *   （用户覆盖层 = 完整列表，加载时全量替换默认，天然支持增删）
 * - 即时生效：保存/恢复默认后调用 petBridge.sync 通知容器重新渲染，无需刷新页面
 *
 * 样式对齐官方设置页：max-width 720px、全走 --dsw-alias-* 语义 token（主题跟随）。
 */
import { assertClientConfig, stripJsonc } from './config';
import type { Corner, Pet } from './types';
import type { ChangeEvent, CSSProperties, Dispatch, FunctionComponent, SetStateAction, useEffect } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';

/** 容器与设置页共享的桥（同一 bundle 单例）：
 * current=最新完整宠物列表（默认空）；sync=容器注册的重渲染回调（未注册时为无操作函数）；
 * template=config.jsonc 默认宠物模板（pets[0]），「添加宠物」用它作为默认配置 */
export const petBridge: {
  current: Pet[];
  sync: (pets: Pet[]) => void;
  template: Pet | undefined;
} = {
  current: [],
  sync: () => {},
  template: undefined,
};

/** 字典命名空间 */
export const NS = 'pet.config';

export const zh = {
  nav: '桌宠配置',
  intro: '管理多个桌宠：每个宠物可独立设置大小与位置（保存后即时生效）。',
  petsLabel: '宠物列表',
  add: '添加宠物',
  remove: '删除',
  confirmRemove: '确定删除宠物「{id}」吗？',
  confirmTitle: '确认操作',
  cancel: '取消',
  atLeastOne: '至少保留一个宠物。',
  emptyPets: '暂无宠物，点击「添加宠物」创建。',
  sizeLabel: '大小（宽度 px）',
  sizeHint: '高度自动 = 宽度 × 9/16。',
  cornerLabel: '位置',
  'corner.top-left': '左上角',
  'corner.top-right': '右上角',
  'corner.bottom-left': '左下角',
  'corner.bottom-right': '右下角',
  marginX: '水平偏移',
  marginY: '垂直偏移',
  save: '保存',
  reset: '恢复默认',
  confirmReset: '确定恢复默认吗？将删除整个用户配置（含自定义的动画池与播放权重）。',
  resetHint: '「重置」会删除整个用户配置（含自定义的动画池与播放权重），不只是宠物列表。',
  configMeta: '高级配置（文件）',
  configMetaHint: '用户配置可覆盖宠物列表 / 动画池 / 播放权重，修改后刷新或重启生效；默认配置为完整参考。',
  defaultConfig: '默认配置（只读，完整参考）',
  userConfig: '用户配置（自定义覆盖）',
  animationDir: '动画素材目录（可自定义/扩充动画）',
  saved: '已保存，桌宠即时生效。',
  loadError: '加载配置失败',
  invalid: '请检查输入：大小需为正数，边距可为任意数字。',
  busy: '保存中…',
};

export const en = {
  nav: 'Pet Config',
  intro: 'Manage multiple pets: each pet has its own size and position (applies instantly after saving).',
  petsLabel: 'Pets',
  add: 'Add pet',
  remove: 'Remove',
  confirmRemove: 'Delete pet "{id}"?',
  confirmTitle: 'Confirm action',
  cancel: 'Cancel',
  atLeastOne: 'Keep at least one pet.',
  emptyPets: 'No pets yet — click "Add pet" to create one.',
  sizeLabel: 'Size (width px)',
  sizeHint: 'Height is automatic = width × 9/16.',
  cornerLabel: 'Position',
  'corner.top-left': 'Top-left',
  'corner.top-right': 'Top-right',
  'corner.bottom-left': 'Bottom-left',
  'corner.bottom-right': 'Bottom-right',
  marginX: 'Horizontal offset',
  marginY: 'Vertical offset',
  save: 'Save',
  reset: 'Reset to default',
  confirmReset: 'Reset to default? This deletes the whole user config (including custom animation pools & weights).',
  resetHint:
    '"Reset" deletes the whole user config (including custom animation pools & weights), not just the pet list.',
  configMeta: 'Advanced (files)',
  configMetaHint:
    'User config may override pets / animation pools / weights — refresh or restart to apply. The default config is the complete reference.',
  defaultConfig: 'Default config (read-only, complete reference)',
  userConfig: 'User config (custom overrides)',
  animationDir: 'Animation assets dir (add/customize animations here)',
  saved: 'Saved — the pets updated instantly.',
  loadError: 'Failed to load config',
  invalid: 'Check your input: size must be positive; margins can be any number.',
  busy: 'Saving…',
};

/**
 * 制造「桌宠配置」设置页组件（工厂函数）。
 *
 * 为什么是工厂而非直接定义组件：client 半侧是 __ModuleLoader__ 单文件形态，
 * react 能力不能顶层 import，只能由 DSH 的 require('react') 在运行时注入，
 * 因此把组件依赖作为参数传入，在工厂内制造出可用的组件后再注册进设置页插槽。
 *
 * @param rt        运行时注入的依赖集合
 * @param rt.h      react/jsx-runtime 的 jsx 函数（即 factory 里的 `h`）——
 *                  用于手写 React 元素，如 `h('button', { onClick, children: '保存' })`
 * @param rt.useState react 的 useState hook——管理页面内可变状态
 *                  （宠物列表 / 选中项 / 忙碌 / 保存消息），值变化时自动重渲染
 * @param rt.t      locale 绑定到本插件的翻译函数（ctx.locale.bind(NS)）——
 *                  取中英文文案，如 `t('nav')` → '桌宠配置' / 'Pet Config'
 * @returns PetConfigSection 组件：即整个「桌宠配置」设置页
 *          （props 仅有 close，由设置页外壳提供，本页当前未使用）
 */
export function makePetConfigSection(rt: {
  h: typeof jsx;
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  useEffect: typeof useEffect;
  t: (key: string) => string;
}): FunctionComponent<{ close?: () => void }> {
  const { h, useState, useEffect, t } = rt;

  const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const cornerLabel = (c: Corner): string => t('corner.' + c);

  const inputStyle = {
    boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    padding: '5px 10px',
    fontSize: '13px',
    minHeight: '28px',
    outline: 'none',
  } as CSSProperties;

  /** 生成一个未占用的宠物 id（pet-2、pet-3…） */
  const nextId = (list: Pet[]): string => {
    let n = 2;
    for (; ; n++) {
      const id = 'pet-' + n;
      if (!list.some((p) => p.id === id)) return id;
    }
  };

  return function PetConfigSection() {
    const initPets = petBridge.current;
    const [pets, setPets] = useState<Pet[]>(initPets.map((p) => ({ ...p, position: { ...p.position } })));
    const [selId, setSelId] = useState<string>(initPets[0]?.id ?? '');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | ''; text: string }>({ kind: '', text: '' });
    // 确认弹窗（仿官方弹窗：遮罩 + 居中卡片 + 双按钮）
    const [confirm, setConfirm] = useState<null | 'remove' | 'reset'>(null);
    // 配置文件地址（「高级配置」区块；读取失败仅缺省不显示，不影响表单）
    const [paths, setPaths] = useState<null | { user: string; default: string; animations: string }>(null);
    useEffect(() => {
      fetch('/miku-pet/config/meta')
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => setPaths(p))
        .catch(() => console.warn('[miku-pet] 读取配置文件路径失败'));
    }, []);

    // 当前选中的宠物对象（表单数据源）；selId 由 add/remove/reset 同步维护，列表非空时恒有效
    const cur = pets.find((p) => p.id === selId) ?? null;

    // 更新选中的宠物：size 走顶层；position 子字段整体替换
    const updateSel = (patch: Partial<Omit<Pet, 'position'>> & { position?: Partial<Pet['position']> }) =>
      setPets((list) =>
        list.map((p) => {
          if (p.id !== selId) return p;
          const { position: posPatch, ...rest } = patch;
          return { ...p, ...rest, position: posPatch ? { ...p.position, ...posPatch } : p.position };
        }),
      );

    const validated = (): boolean => {
      for (const p of pets) {
        if (
          !Number.isFinite(p.size) ||
          p.size <= 0 ||
          !Number.isFinite(p.position.marginX) ||
          !Number.isFinite(p.position.marginY)
        ) {
          setMsg({ kind: 'err', text: t('invalid') });
          return false;
        }
      }
      return true;
    };

    const save = async () => {
      const isOk = validated();
      if (!isOk) return;
      setBusy(true);
      setMsg({ kind: '', text: '' });
      try {
        const res = await fetch('/miku-pet/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pets: pets }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        petBridge.current = pets;
        petBridge.sync(pets);
        setMsg({ kind: 'ok', text: t('saved') });
      } catch {
        setMsg({ kind: 'err', text: t('loadError') });
      } finally {
        setBusy(false);
      }
    };

    const reset = () => setConfirm('reset');

    const doReset = async () => {
      setBusy(true);
      setMsg({ kind: '', text: '' });
      try {
        await fetch('/miku-pet/config', { method: 'DELETE' });
        const defRes = await fetch('/miku-pet/config.jsonc?v=' + Date.now());
        const defs = assertClientConfig(JSON.parse(stripJsonc(await defRes.text()))).pets;
        setPets(defs.map((p) => ({ ...p, position: { ...p.position } })));
        setSelId(defs[0]?.id ?? '');
        petBridge.current = defs;
        petBridge.sync(defs);
        setMsg({ kind: 'ok', text: t('saved') });
      } catch {
        setMsg({ kind: 'err', text: t('loadError') });
      } finally {
        setBusy(false);
      }
    };

    const addPet = () => {
      const tpl = petBridge.template;
      if (!tpl) return;
      const id = nextId(pets);
      setPets((list) => [...list, { id, size: tpl.size, position: { ...tpl.position } }]);
      setSelId(id);
    };

    const removeSel = () => {
      if (pets.length <= 1) {
        setMsg({ kind: 'err', text: t('atLeastOne') });
        return;
      }
      setConfirm('remove');
    };

    const doRemove = () => {
      const list = pets.filter((p) => p.id !== selId);
      setPets(list);
      setSelId(list[0].id);
    };

    const field = (key: 'size' | 'marginX' | 'marginY', value: number, setter: (v: number) => void, width: string) =>
      h('input', {
        type: 'number',
        step: key === 'size' ? '10' : '1',
        min: key === 'size' ? '120' : '',
        value: String(value),
        disabled: busy,
        onChange: (e: ChangeEvent<HTMLInputElement>) => setter(Number(e.target.value)),
        style: { width, ...inputStyle },
      });

    return h('section', {
      style: {
        maxWidth: '720px',
        color: 'var(--dsw-alias-label-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
      children: [
        h('h2', {
          style: { margin: 0, fontSize: '16px', fontWeight: 500, lineHeight: '24px' },
          children: t('nav'),
        }),
        h('p', {
          style: {
            margin: 0,
            fontSize: '14px',
            color: 'var(--dsw-alias-label-tertiary)',
            lineHeight: '22px',
          },
          children: t('intro'),
        }),

        // 宠物列表 + 添加
        h('div', {
          style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' },
          children: [
            h('span', {
              style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
              children: t('petsLabel'),
            }),
            ...pets.map((p) =>
              h('button', {
                key: p.id,
                type: 'button',
                onClick: () => setSelId(p.id),
                style: {
                  border:
                    '1px solid ' +
                    (p.id === selId ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'),
                  background: p.id === selId ? 'var(--dsw-alias-interactive-bg-active)' : 'transparent',
                  color: 'var(--dsw-alias-label-primary)',
                  borderRadius: '8px',
                  padding: '4px 12px',
                  fontSize: '13px',
                  cursor: 'pointer',
                },
                children: p.id + ' (' + p.size + 'px)',
              }),
            ),
            h('button', {
              type: 'button',
              onClick: addPet,
              disabled: busy,
              style: {
                border: '1px dashed var(--dsw-alias-border-l2)',
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary)',
                borderRadius: '8px',
                padding: '4px 12px',
                fontSize: '13px',
                cursor: 'pointer',
              },
              children: '+ ' + t('add'),
            }),
          ],
        }),

        // 选中宠物表单
        cur
          ? h('div', {
              style: {
                display: 'flex',
                gap: '16px',
                flexWrap: 'wrap',
                marginTop: '8px',
                padding: '12px 14px',
                border: '1px solid var(--dsw-alias-border-l2)',
                borderRadius: '12px',
              },
              children: [
                h('label', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '12px',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                  children: [
                    t('sizeLabel'),
                    field('size', cur.size, (v) => updateSel({ size: v }), '150px'),
                    h('span', {
                      style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
                      children: t('sizeHint'),
                    }),
                  ],
                }),
                h('label', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '12px',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                  children: [
                    t('cornerLabel'),
                    h('select', {
                      value: cur.position.corner,
                      disabled: busy,
                      onChange: (e: ChangeEvent<HTMLSelectElement>) =>
                        updateSel({ position: { corner: e.target.value as Corner } }),
                      style: { width: '160px', ...inputStyle },
                      children: CORNERS.map((c) =>
                        h('option', {
                          key: c,
                          value: c,
                          children: cornerLabel(c),
                        }),
                      ),
                    }),
                  ],
                }),
                h('label', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '12px',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                  children: [
                    t('marginX'),
                    field('marginX', cur.position.marginX, (v) => updateSel({ position: { marginX: v } }), '120px'),
                  ],
                }),
                h('label', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '12px',
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                  children: [
                    t('marginY'),
                    field('marginY', cur.position.marginY, (v) => updateSel({ position: { marginY: v } }), '120px'),
                  ],
                }),
                h('button', {
                  type: 'button',
                  onClick: removeSel,
                  disabled: busy,
                  title: t('remove'),
                  style: {
                    alignSelf: 'flex-end',
                    border: '1px solid var(--dsw-alias-state-error-secondary)',
                    background: 'transparent',
                    color: 'var(--dsw-alias-state-error-primary)',
                    borderRadius: '8px',
                    padding: '4px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                  },
                  children: t('remove'),
                }),
              ],
            })
          : h('p', {
              style: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-label-tertiary)' },
              children: t('emptyPets'),
            }),

        // 操作区
        h('div', {
          style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' },
          children: [
            h('button', {
              type: 'button',
              disabled: busy,
              onClick: save,
              style: {
                border: '1px solid var(--dsw-alias-button-info-fill)',
                background: 'var(--dsw-alias-button-info-fill)',
                color: '#fff',
                borderRadius: '8px',
                padding: '4px 14px',
                fontSize: '12px',
                cursor: 'pointer',
                opacity: busy ? 0.5 : 1,
              },
              children: t('save'),
            }),
            h('button', {
              type: 'button',
              disabled: busy,
              onClick: reset,
              style: {
                border: '1px solid var(--dsw-alias-border-l2)',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                borderRadius: '8px',
                padding: '4px 14px',
                fontSize: '12px',
                cursor: 'pointer',
                opacity: busy ? 0.5 : 1,
              },
              children: t('reset'),
            }),
            msg.text
              ? h('span', {
                  style: {
                    fontSize: '12px',
                    color:
                      msg.kind === 'err' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-ok-primary)',
                    marginLeft: '4px',
                  },
                  children: msg.text,
                })
              : null,
          ],
        }),

        // 重置的副作用提示（DELETE 会清掉整个用户配置，含高级自定义）
        h('p', {
          style: { margin: 0, fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: '16px' },
          children: t('resetHint'),
        }),

        // 高级配置（文件地址）：供高级用户直接编辑配置文件自定义
        paths
          ? h('div', {
              style: {
                marginTop: '12px',
                padding: '10px 14px',
                border: '1px solid var(--dsw-alias-border-l2)',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--dsw-alias-label-secondary)',
              },
              children: [
                h('div', {
                  style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', fontWeight: 500 },
                  children: t('configMeta'),
                }),
                h('div', { style: { fontSize: '12px', lineHeight: '20px' }, children: t('configMetaHint') }),
                h('div', {
                  style: { fontSize: '12px', lineHeight: '18px', wordBreak: 'break-all' },
                  children: t('defaultConfig') + '：' + paths.default,
                }),
                h('div', {
                  style: { fontSize: '12px', lineHeight: '18px', wordBreak: 'break-all' },
                  children: t('userConfig') + '：' + paths.user,
                }),
                h('div', {
                  style: { fontSize: '12px', lineHeight: '18px', wordBreak: 'break-all' },
                  children: t('animationDir') + '：' + paths.animations,
                }),
              ],
            })
          : null,

        // 确认弹窗（仿官方弹窗视觉：遮罩 + 居中卡片 + 双按钮）
        confirm
          ? h('div', {
              style: {
                position: 'fixed',
                inset: 0,
                zIndex: 2147483647,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.45)',
              },
              onClick: () => setConfirm(null),
              children: h('div', {
                style: {
                  width: '340px',
                  maxWidth: 'calc(100vw - 40px)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  borderRadius: '12px',
                  padding: '16px 18px',
                  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                },
                onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
                children: [
                  h('div', {
                    style: { fontSize: '14px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
                    children: t('confirmTitle'),
                  }),
                  h('div', {
                    style: { fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
                    children: confirm === 'remove' ? t('confirmRemove').replace('{id}', selId) : t('confirmReset'),
                  }),
                  h('div', {
                    style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
                    children: [
                      h('button', {
                        type: 'button',
                        onClick: () => setConfirm(null),
                        style: {
                          border: '1px solid var(--dsw-alias-border-l2)',
                          background: 'transparent',
                          color: 'var(--dsw-alias-label-primary)',
                          borderRadius: '8px',
                          padding: '4px 14px',
                          fontSize: '12px',
                          cursor: 'pointer',
                        },
                        children: t('cancel'),
                      }),
                      h('button', {
                        type: 'button',
                        onClick: () => {
                          const k = confirm;
                          setConfirm(null);
                          if (k === 'remove') doRemove();
                          else void doReset();
                        },
                        style:
                          confirm === 'remove'
                            ? {
                                border: '1px solid var(--dsw-alias-state-error-secondary)',
                                background: 'transparent',
                                color: 'var(--dsw-alias-state-error-primary)',
                                borderRadius: '8px',
                                padding: '4px 14px',
                                fontSize: '12px',
                                cursor: 'pointer',
                              }
                            : {
                                border: '1px solid var(--dsw-alias-button-info-fill)',
                                background: 'var(--dsw-alias-button-info-fill)',
                                color: '#fff',
                                borderRadius: '8px',
                                padding: '4px 14px',
                                fontSize: '12px',
                                cursor: 'pointer',
                              },
                        children: confirm === 'remove' ? t('remove') : t('reset'),
                      }),
                    ],
                  }),
                ],
              }),
            })
          : null,
      ],
    });
  };
}
