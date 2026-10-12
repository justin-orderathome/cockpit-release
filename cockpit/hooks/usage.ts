import type { UsageSnapshot } from '../types'
import { textWidth } from './layout'

export type Chip = {
  key: 'ctx' | 'h5' | 'wk'
  label: 'CTX' | '5H' | 'WK'
  /** undefined 表示還沒有資料 */
  percent?: number
  /** 進度條後面的文字：CTX 是「已用/窗口」，5H 是重置倒數，WK 是重置日期 */
  extra?: string
}

/** 還沒有上下文用量時，接在用量後面的提示 */
export const USAGE_HINT = '首次回應後顯示'

/** CTX 一律有；有額度資料時再加 5H、WK。每一項進度條後面的文字都帶著，要不要畫由 `chipArea` 決定。 */
export function chipsFrom(usage: UsageSnapshot, now: number): Chip[] {
  const { contextTokens: tokens, contextWindow: window } = usage
  const used = tokens !== undefined && window !== undefined ? `${shortTokens(tokens)}/${shortTokens(window)}` : undefined
  const chips: Chip[] = [{ key: 'ctx', label: 'CTX', percent: usage.contextPercent, extra: used }]
  const h5 = usage.rateLimits.find(r => r.kind === 'five_hour')
  const wk = usage.rateLimits.find(r => r.kind === 'seven_day')
  if (h5) chips.push({ key: 'h5', label: '5H', percent: h5.percentUsed, extra: countdown(h5.resetsAt, now) })
  if (wk) chips.push({ key: 'wk', label: 'WK', percent: wk.percentUsed, extra: resetDate(wk.resetsAt, now) })
  return chips
}

/** token 數的短寫：544k、200k、1M、1.5M。 */
export function shortTokens(n: number): string {
  if (n >= 999_500) return `${Math.round(n / 100_000) / 10}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

/** 10-14：重置的日期（電腦的當地時區）；過期或沒有時間則為 undefined。 */
export function resetDate(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const at = new Date(resetsAt)
  if (!Number.isFinite(at.getTime()) || at.getTime() <= now) return undefined
  return `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

/** 2h10m、45m；過期或沒有時間則為 undefined。 */
export function countdown(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const minutes = Math.ceil(ms / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

export type ChipArea = {
  /** 要畫的各項；這個寬度下不畫的文字，`extra` 已經拿掉 */
  chips: Chip[]
  /** 各項排成一行（只有一項時也算） */
  isOneLine: boolean
  /** 排成一行時，兩項之間隔幾格 */
  gap: number
  barWidth: number
  /** 還沒有上下文用量時，後面接一句 `USAGE_HINT` */
  showHint: boolean
  /** 用量佔幾行：排成一行，或一項一行（提示也佔一行） */
  rows: number
}

/** 排成一行時兩項之間的間隔；進度條的寬度範圍（一項一行時可以長一點） */
const GAP = 3
const MIN_BAR = 4
const MAX_BAR = 8
const MAX_BAR_ALONE = 10

/** 寬度不夠時，進度條後面的文字照這個順序一段一段隱藏：先是 WK 的日期，再來 5H 的倒數，最後 CTX 的用量 */
const HIDE_ORDER: readonly Chip['key'][] = ['wk', 'h5', 'ctx']

/** 一項扣掉進度條的寬度：標籤、空白、百分比（4 格）、空白，以及進度條後面的文字 */
const fixedWidth = (chip: Chip) => chip.label.length + 1 + 4 + 1 + (chip.extra ? 1 + textWidth(chip.extra) : 0)

/**
 * 「狀態」框裡的用量：要畫哪幾項、怎麼排、佔幾行，在這裡一次決定。
 * 先試排成一行、文字全留；進度條不到 4 格就藏掉一段文字再試（順序見 `HIDE_ORDER`）；
 * 文字都藏了還是放不下，才改成一項一行，這時每行夠寬，文字全部顯示。
 */
export function chipArea(usage: UsageSnapshot, now: number, width: number): ChipArea {
  const all = chipsFrom(usage, now)
  const showHint = usage.contextPercent === undefined
  const hint = showHint ? GAP + textWidth(USAGE_HINT) : 0
  for (let hidden = 0; hidden <= HIDE_ORDER.length; hidden++) {
    const gone = new Set(HIDE_ORDER.slice(0, hidden))
    const chips = all.map(c => (gone.has(c.key) ? { ...c, extra: undefined } : c))
    const fixed = chips.reduce((n, c) => n + fixedWidth(c), 0) + GAP * (chips.length - 1) + hint
    const barWidth = Math.min(MAX_BAR, Math.floor((width - fixed) / chips.length))
    // 只有一項時不必換行，再窄也排成一行
    const isLastResort = chips.length === 1 && hidden === HIDE_ORDER.length
    if (barWidth >= MIN_BAR || isLastResort) {
      return { chips, isOneLine: true, gap: GAP, barWidth: Math.max(MIN_BAR, barWidth), showHint, rows: 1 }
    }
  }
  const widest = Math.max(...all.map(fixedWidth))
  return {
    chips: all,
    isOneLine: false,
    gap: 0,
    barWidth: Math.max(MIN_BAR, Math.min(MAX_BAR_ALONE, width - widest)),
    showHint,
    rows: all.length + (showHint ? 1 : 0),
  }
}

/**
 * 用量的顏色：平常不上色（跟一般文字一樣），到黃色門檻用主題的警告色，到紅色門檻用錯誤色。
 * 顏色只在需要注意時出現。
 */
export function chipColor(percent: number | undefined, yellow: number, red: number): 'warning' | 'error' | undefined {
  const p = percent ?? 0
  return p < yellow ? undefined : p < red ? 'warning' : 'error'
}

/**
 * 一項用量要畫的字：百分比（補到 4 格）與進度條的實心、空心兩段。
 * 進度條用方塊而不是細線：雖然搶眼，但一眼就看得出用了多少。
 */
export function chipParts(chip: Chip, barWidth: number): { percent: string; filled: string; rest: string } {
  const pct = chip.percent === undefined ? '—' : `${Math.round(chip.percent)}%`
  const n = chip.percent === undefined ? 0 : Math.round((Math.min(100, Math.max(0, chip.percent)) / 100) * barWidth)
  return { percent: pct.padEnd(4), filled: '█'.repeat(n), rest: '░'.repeat(barWidth - n) }
}

/** 每個用量在 toast 判斷時的識別：上下文是 `ctx`，額度依時段區分。 */
const alertKey = (kind: string, resetsAt: string | undefined) => (kind === 'ctx' ? 'ctx' : `${kind}:${resetsAt ?? ''}`)

/**
 * 依門檻判斷要跳哪些 toast：剛跨過門檻、這個時段還沒提醒過的才跳。
 * 回到門檻以下的會從已提醒清單移除（上下文被壓縮後可以再提醒）。
 * `isFirst` 時只記下目前已超過的，不跳 toast：剛開的 session 不算「剛跨過」。
 */
export function checkAlerts(
  usage: UsageSnapshot,
  threshold: number | undefined,
  alerted: readonly string[],
  isFirst: boolean,
): { alerted: string[]; toasts: string[] } {
  if (threshold === undefined) return { alerted: [...alerted], toasts: [] }
  const readings = [
    ...(usage.contextPercent === undefined ? [] : [{ kind: 'ctx', label: '上下文', percent: usage.contextPercent }]),
    ...usage.rateLimits
      .filter(r => r.kind === 'five_hour' || r.kind === 'seven_day')
      .map(r => ({
        kind: r.kind,
        label: r.kind === 'five_hour' ? '5 小時額度' : '本週額度',
        percent: r.percentUsed,
        resetsAt: r.resetsAt,
      })),
  ]
  const next = new Set(alerted)
  const toasts: string[] = []
  for (const r of readings) {
    const key = alertKey(r.kind, 'resetsAt' in r ? r.resetsAt : undefined)
    if (r.percent < threshold) {
      next.delete(key)
    } else if (!next.has(key)) {
      next.add(key)
      if (!isFirst) toasts.push(`${r.label}已用 ${Math.round(r.percent)}%`)
    }
  }
  return { alerted: [...next], toasts }
}
