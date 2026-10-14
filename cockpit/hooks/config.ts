import type { Tab } from '../types'

/** [設定] 分頁的參數；值存在 userConfig（settings.json 的 pluginConfigs.cockpit）。 */
export type Settings = {
  accent: string
  yellow: number
  red: number
  /** undefined 表示關掉 toast */
  toast?: number
  autoOpen: boolean
  /** 'last' 表示上次停的分頁 */
  defaultTab: 'last' | Exclude<Tab, 'settings'>
  inlineRows: number
  /** 把 SKILL 的說明翻成繁體中文 */
  translate: boolean
  /** 讀 SKILL 的原文，整理成用法 */
  howto: boolean
  /** [SKILL] 一組裡的 skill 橫向排成幾欄，或一個一行 */
  skillLayout: 'grid' | 'list'
  /** 開場時自己看有沒有發布新版，有就下載，下次開啟換上 */
  autoUpdate: boolean
}

/** 四個分頁：id、顯示名稱與快捷鍵 */
export const TABS: readonly { id: Tab; label: string; hotkey: string }[] = [
  { id: 'tasks', label: '任務', hotkey: '1' },
  { id: 'basic', label: '基本', hotkey: '2' },
  { id: 'skill', label: 'SKILL', hotkey: '3' },
  { id: 'settings', label: '設定', hotkey: '4' },
]

export const ACCENTS = ['claude', 'suggestion', 'remember', 'planMode', 'autoAccept', 'ide', 'permission', 'merged'] as const
const THRESHOLDS = ['40', '50', '60', '70', '80', '90'] as const
const TOASTS = ['off', '70', '80', '90'] as const
const ROWS = ['4', '6', '8', '10', '12'] as const

/** 每個參數：userConfig 的欄位名、預設值（userConfig 存的字串）、選項與顯示文字 */
export const FIELDS = [
  { group: '外觀', field: 'accent', label: '強調色', fallback: 'claude', options: ACCENTS.map(v => ({ value: v })) },
  { group: '用量', field: 'yellow', label: '黃色門檻', fallback: '50', options: THRESHOLDS.map(v => ({ value: v, label: `${v}%` })) },
  { group: '用量', field: 'red', label: '紅色門檻', fallback: '80', options: THRESHOLDS.map(v => ({ value: v, label: `${v}%` })) },
  {
    group: '用量',
    field: 'toast',
    label: 'toast 門檻',
    fallback: '80',
    options: TOASTS.map(v => ({ value: v, label: v === 'off' ? '關' : `${v}%` })),
  },
  {
    group: '面板',
    field: 'autoOpen',
    label: '自動開啟',
    fallback: 'on',
    options: [
      { value: 'on', label: '開' },
      { value: 'off', label: '關' },
    ],
  },
  {
    group: '面板',
    field: 'defaultTab',
    label: '預設分頁',
    fallback: 'last',
    // [設定] 不能當預設分頁
    options: [
      { value: 'last', label: '上次停的' },
      ...TABS.filter(t => t.id !== 'settings').map(t => ({ value: t.id, label: t.label })),
    ],
  },
  { group: '面板', field: 'inlineRows', label: 'inline 行數', fallback: '8', options: ROWS.map(v => ({ value: v })) },
  {
    group: 'SKILL',
    field: 'translate',
    label: '翻譯說明',
    fallback: 'on',
    options: [
      { value: 'on', label: '開' },
      { value: 'off', label: '關' },
    ],
  },
  {
    group: 'SKILL',
    field: 'howto',
    label: '整理用法',
    fallback: 'on',
    options: [
      { value: 'on', label: '開' },
      { value: 'off', label: '關' },
    ],
  },
  {
    group: 'SKILL',
    field: 'skillLayout',
    label: '排列方式',
    fallback: 'grid',
    options: [
      { value: 'grid', label: '橫向' },
      { value: 'list', label: '垂直' },
    ],
  },
  {
    group: '更新',
    field: 'autoUpdate',
    label: '自動更新',
    fallback: 'off',
    options: [
      { value: 'on', label: '開' },
      { value: 'off', label: '關' },
    ],
  },
] as const

export type Field = (typeof FIELDS)[number]['field']

/** userConfig 存的原始字串；不在選項裡的值當作沒設定。 */
export function rawValues(options: Readonly<Record<string, unknown>> | undefined): Record<Field, string> {
  const out = {} as Record<Field, string>
  for (const f of FIELDS) {
    const v = options?.[f.field]
    const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'number' ? String(v) : v
    out[f.field] = typeof s === 'string' && f.options.some(o => o.value === s) ? s : f.fallback
  }
  return out
}

/** 改過（不是預設值）的參數；[設定] 拿來標出改過的、寫「恢復預設值」會改幾項 */
export const changedFields = (raw: Readonly<Record<Field, string>>): Field[] =>
  FIELDS.filter(f => raw[f.field] !== f.fallback).map(f => f.field)

/** 「恢復預設值」按鈕上的字：寫出會改幾項；都是預設值時說明不必按 */
export const resetLabel = (changed: number) => (changed === 0 ? '恢復預設值（都是預設）' : `恢復預設值（${changed} 項）`)

export function parseSettings(options: Readonly<Record<string, unknown>> | undefined): Settings {
  const raw = rawValues(options)
  return {
    accent: raw.accent,
    yellow: Number(raw.yellow),
    red: Number(raw.red),
    toast: raw.toast === 'off' ? undefined : Number(raw.toast),
    autoOpen: raw.autoOpen === 'on',
    defaultTab: raw.defaultTab as Settings['defaultTab'],
    inlineRows: Number(raw.inlineRows),
    translate: raw.translate === 'on',
    howto: raw.howto === 'on',
    skillLayout: raw.skillLayout as Settings['skillLayout'],
    autoUpdate: raw.autoUpdate === 'on',
  }
}
