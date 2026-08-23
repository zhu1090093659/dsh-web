// client 半侧「装配层」：注入 react → 组装两个页面组件 → 注册进 DSH 插槽。
// 页面代码不在本文件：宠物页面在 pet.ts，设置页在 settings.ts——
// 类似 Vue 的 App.vue 只挂根组件、SpringBoot 启动类只做装配，不写页面业务。
import { makePetUI } from './pet';
import { makePetConfigSection, NS, zh, en } from './settings';
import type * as ReactNS from 'react';

/**
 * 返回 DSH 插件 factory：`(require) => module`。
 * 插件三件套（name / inject / apply）都在其返回的 module 上。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH __ModuleLoader__ 契约（f(require) => module），外部无静态类型
export function makeFactory(): (require: (mod: string) => any) => any {
  return (require) => {
    const module = { exports: {} };

    const react: typeof ReactNS = require('react');
    const { useEffect, useRef, useState } = react;
    const { jsx: h } = require('react/jsx-runtime');

    // 宠物页面（overlay）与配置设置页：组件各自独立文件，这里只组装 + 注册
    const PetMulti = makePetUI({ h, useState, useEffect, useRef });

    const name = 'miku-pet';
    const inject = ['slots', 'locale'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 注入的 ctx（locale/slots/webServer 等 service 无静态类型）
    function apply(ctx: any) {
      // 本地化字典（设置页文案）
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'miku-pet: dictionaries');
      const t = ctx.locale.bind(NS);

      // 宠物 overlay（多开：容器渲染多个 PetCard）
      ctx.slots.inject('shell.overlay', function* () {
        yield ctx.slots.register({ name: 'shell.overlay', id: 'miku-pet', order: 1000 }, () => h(PetMulti, {}));
      });

      // 设置页：「桌宠配置」（大小/位置，保存即时生效）
      const PetConfigSection = makePetConfigSection({ h, useState, useEffect, t });
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register(
          { name: 'settings.section', id: 'miku-pet-config', order: 30, label: () => t('nav'), inject: () => ({ t }) },
          PetConfigSection,
        );
      });
    }

    module.exports = { apply, inject, name };
    return module.exports;
  };
}
