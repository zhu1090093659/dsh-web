/**
 * Card copy for the provider sign-in seats. Chinese first: the family's
 * primary audience, with English alongside.
 * @module @linxin666/dsh-provider-signin/client/locales
 */

/** Locale namespace owned by this plugin. */
export const NS = 'provider-signin'

export const zh = {
  'status.none': '未登录',
  'status.oauth': '已登录（订阅授权）',
  'status.apikey': '已存 API key',
  'signIn': '登录',
  'cancel': '取消',
  'close': '关闭',
  'answer': '提交',
  'pickMethod': '选择登录方式',
  'inputPrompt': '请输入',
  'secretPrompt': '请输入（不会显示）',
  'running': '登录进行中…',
  'authorized': '登录成功',
  'cancelled': '已取消',
  'failed': '登录失败',
  'openPage': '打开授权页面',
  'enterCode': '在此页面输入代码：',
  'transport': '与主进程通信失败',
}

export const en = {
  'status.none': 'Not signed in',
  'status.oauth': 'Signed in (subscription OAuth)',
  'status.apikey': 'API key stored',
  'signIn': 'Sign in',
  'cancel': 'Cancel',
  'close': 'Close',
  'answer': 'Submit',
  'pickMethod': 'Pick a sign-in method',
  'inputPrompt': 'Enter value',
  'secretPrompt': 'Enter value (hidden)',
  'running': 'Signing in…',
  'authorized': 'Signed in',
  'cancelled': 'Cancelled',
  'failed': 'Sign-in failed',
  'openPage': 'Open the authorization page',
  'enterCode': 'Enter this code on that page:',
  'transport': 'Host relay unreachable',
}

export type SigninKey = keyof typeof zh

/** Dictionary shape shared by every locale this plugin registers. */
export const dictionaries: Record<'zh' | 'en', Record<SigninKey, string>> = { zh, en }
