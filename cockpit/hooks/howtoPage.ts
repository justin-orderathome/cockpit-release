import type { SkillItem } from '../types'
import { HOWTO_PARTS } from './howto'
import { textWidth, wrapText } from './layout'
import type { TutorialState } from './tutorial'

/**
 * 用法頁有哪些列、每一列是什麼字：教學的狀態、說明、標題線、四項用法。
 * 只決定內容與折行，不碰引擎也不畫；怎麼畫（顏色、按鈕）由面板決定。
 */

export type HowtoPageRow =
  /** 已經有教學時的那一行；`isStale` 是原文更新過。後面接「重新產生」的按鈕 */
  | { id: string; kind: 'tutorial'; text: string; isStale: boolean }
  /** 說明折行後的一行 */
  | { id: string; kind: 'description'; text: string }
  /** 用法的標題線：`note` 是只依說明整理時的標示（沒有就是空的），`fill` 是補滿寬度的線 */
  | { id: string; kind: 'rule'; text: string; note: string; fill: string }
  /** 某一項用法折行後的一行；`label` 只有那一項的第一行有 */
  | { id: string; kind: 'part'; label: string; text: string }

export type HowtoPage = {
  /** 標題欄的寬度：最長的標題加一格間隔 */
  labelWidth: number
  rows: HowtoPageRow[]
}

const RULE = '── 用法 '

/**
 * 一個 skill 的用法頁，寬 `cols` 格。沒有用法的 skill 沒有用法頁，回傳 undefined。
 * 教學還在產生時不顯示教學那一行（標題列已經寫著產生中）。
 */
export function viewHowtoPage(
  skill: Pick<SkillItem, 'description' | 'howto' | 'howtoKind'>,
  tutorial: TutorialState,
  isMakingTutorial: boolean,
  cols: number,
): HowtoPage | undefined {
  const { howto } = skill
  if (howto === undefined) return undefined
  const labelWidth = Math.max(...HOWTO_PARTS.map(p => textWidth(p.label))) + 1
  const rows: HowtoPageRow[] = []
  if ((tutorial === 'fresh' || tutorial === 'stale') && !isMakingTutorial) {
    const isStale = tutorial === 'stale'
    rows.push({ id: 'howto-tutorial', kind: 'tutorial', text: isStale ? '教學：原文已更新' : '教學：已產生', isStale })
  }
  for (const [i, text] of wrapText(skill.description, cols).entries()) {
    rows.push({ id: `howto-desc-${i}`, kind: 'description', text })
  }
  // 原料是 description 的用法可能不完整，在標題線旁標出來
  const note = skill.howtoKind === 'description' ? '只依說明整理' : ''
  const noteWidth = note === '' ? 0 : textWidth(note) + 1
  rows.push({
    id: 'howto-rule',
    kind: 'rule',
    text: RULE,
    note,
    fill: (note === '' ? '' : ' ') + '─'.repeat(Math.max(0, cols - textWidth(RULE) - noteWidth)),
  })
  for (const part of HOWTO_PARTS) {
    // 「搭配」的 skill 接成一行；其餘一條一行，折行時對齊內容
    const entries = part.key === 'with' ? [howto.with.join('、')] : howto[part.key]
    const lines = entries.filter(t => t !== '').flatMap(t => wrapText(t, Math.max(4, cols - labelWidth)))
    for (const [i, text] of lines.entries()) {
      rows.push({ id: `howto-${part.key}-${i}`, kind: 'part', label: i === 0 ? part.label : '', text })
    }
  }
  return { labelWidth, rows }
}
