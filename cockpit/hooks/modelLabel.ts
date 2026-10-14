/**
 * 模型標示：行尾靠右的「sonnet · high」。只標和主對話不同的；放不下時整塊退成 4 欄的縮寫「S·hi」。
 * [任務] 的 subagent 列與路線圖上經手的票共用，所以只認「一塊裡有哪幾列、各自的名稱有幾欄」，不認列長什麼樣。
 */
import type { ModelUse } from '../types'
import { fitText, textWidth } from './layout'

/** 一塊裡的一列：它在用的模型（沒有就不標），以及不標時名稱有幾欄 */
export type LabelSlot = { use?: ModelUse; room: number }

/** 一塊的標示：完整或縮寫、那一欄多寬（0 表示整塊都不標），以及每一列補到欄寬的字（不標的是 undefined） */
export type ModelLabels = { form: 'full' | 'short'; width: number; labels: (string | undefined)[] }

/** 名稱至少留幾欄 */
const MIN_NAME = 8
/** 標示和名稱之間隔一格 */
const GAP = 1
/** 認不出的 id 在完整那一欄最多寫幾欄 */
const MAX_ID = 16
/** 縮寫固定 4 欄 */
const SHORT = 4

const LETTERS: Record<string, string> = { opus: 'O', sonnet: 'S', haiku: 'H' }
const EFFORTS: Record<string, string> = { low: 'lo', medium: 'md', high: 'hi', xhigh: 'xh', max: 'mx' }

/** `claude-<別名>-…` 的別名；抽不出是 undefined */
const aliasOf = (model: string) => /^claude-([a-z]+)-/.exec(model)?.[1]

/** 靠右補到 `width` 格（照畫面上的格數，不照字數） */
const padTo = (text: string, width: number) => ' '.repeat(Math.max(0, width - textWidth(text))) + text

/** 模型與深度都相同；任一邊沒有就不算 */
export const isSameUse = (a: ModelUse | undefined, b: ModelUse | undefined) =>
  a !== undefined && b !== undefined && a.model === b.model && a.effort === b.effort

/** 完整的寫法：「別名 · 深度」；認不出的 id 照原樣（太長截短）；沒有深度只寫別名 */
function fullOf(use: ModelUse): string {
  const alias = aliasOf(use.model)
  const name = alias ?? fitText(use.model, MAX_ID)
  return use.effort === undefined ? name : `${name} · ${use.effort}`
}

/** 縮寫：「字母·深度縮寫」，例如 S·hi；認不出的模型寫 ?，沒有深度只寫字母加 ·（H·） */
function shortOf(use: ModelUse): string {
  const alias = aliasOf(use.model)
  const letter = (alias === undefined ? undefined : LETTERS[alias]) ?? '?'
  const effort = use.effort === undefined ? '' : (EFFORTS[use.effort] ?? use.effort.slice(0, 2))
  return `${letter}·${effort}`
}

/**
 * 一整塊（[任務] 清單、或路線圖）的標示。`base` 是主對話最近一次的模型與深度，和它完全相同的不標。
 * 任一列放完整的寫法後名稱會少於 8 欄，整塊都用縮寫；用了縮寫名稱仍少於 8 欄的那一列不標。
 */
export function modelLabels(slots: readonly LabelSlot[], base: ModelUse | undefined): ModelLabels {
  const marked = slots.map(s => (s.use === undefined || isSameUse(s.use, base) ? undefined : s.use))
  const fulls = marked.map(u => (u === undefined ? undefined : fullOf(u)))
  const width = Math.max(0, ...fulls.map(t => (t === undefined ? 0 : textWidth(t))))
  const fits = (i: number, w: number) => slots[i]!.room - w - GAP >= MIN_NAME
  if (fulls.every((t, i) => t === undefined || fits(i, width))) {
    return { form: 'full', width, labels: fulls.map(t => (t === undefined ? undefined : padTo(t, width))) }
  }
  const labels = marked.map((u, i) => (u === undefined || !fits(i, SHORT) ? undefined : padTo(shortOf(u), SHORT)))
  return { form: 'short', width: labels.some(t => t !== undefined) ? SHORT : 0, labels }
}
