/**
 * ============================================================================
 * miku-pet 浏览器半侧的类型声明（TypeScript）
 * ============================================================================
 *
 * 给 lib/client.js（浏览器半侧）提供类型信息。纯类型文件，不影响运行时。
 *
 * 【对应实现】
 *   lib/client.js —— 注册宠物到官方 `shell.overlay` 列表槽，帧序列播放 +
 *   5s 随机待机掷骰 / 拖拽 / 摔倒→站起；设置页注册到 `settings.section`。
 *
 * ============================================================================
 * @module miku-pet/client
 */
import type { Context } from '@deepseek-ai/dsh-client-runtime';

/** Cordis 插件名（loader 诊断用），与 lib/client.js 的 name 一致 */
export declare const name = 'miku-pet';
/** 需要注入的服务列表（slots/locale），与 lib/client.js 的 inject 一致 */
export declare const inject: string[];

/**
 * 客户端插件主体：把宠物注册进 `shell.overlay`，把桌宠配置注册进 `settings.section`。
 * @param ctx - 客户端根上下文（ctx.slots / ctx.locale 提供槽位注册与本地化）
 */
export declare function apply(ctx: Context): void;