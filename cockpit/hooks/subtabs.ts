/**
 * [任務] 的子分頁（路線圖／任務／背景）：哪幾個分頁籤要畫、各寫什麼、現在看的是哪一個。
 * 不碰引擎，`register.tsx` 照這裡給的段落畫，按鍵與點擊都寫回 `subtab` 這個 atom。
 */
import type { BackgroundList, Effort, Subtab } from '../types'
import { isEmptyBackground } from './background'
import { tabBar } from './layout'
import type { TabSegment } from './layout'

/** 子分頁的順序、名稱與熱鍵（面板按鈕的熱鍵只能是一個數字或小寫字母；`1`–`4` 與 `c d e o p q r u` 已被占用；`b` 只在 [SKILL] 的用法頁當「返回」，不會同時出現） */
export const SUBTABS: readonly { id: Subtab; label: string; hotkey: string }[] = [
  { id: 'roadmap', label: '路線圖', hotkey: 'm' },
  { id: 'tasks', label: '任務', hotkey: 't' },
  { id: 'background', label: '背景', hotkey: 'b' },
]

/** 打開 [任務] 時預設的子分頁，也是正在看的子分頁變空時跳回去的那一個 */
export const DEFAULT_SUBTAB: Subtab = 'tasks'

/** 決定子分頁存不存在的原始狀態：畫面與寫入都拿得到這兩份 */
export type SubtabSources = { efforts: readonly Effort[]; background: BackgroundList }

/** 子分頁存不存在：任務永遠在；路線圖有 effort 就在（全部結案也算）；背景有沒被隱藏的工作才在 */
function isPresent(id: Subtab, { efforts, background }: SubtabSources): boolean {
  if (id === 'roadmap') return efforts.length > 0
  if (id === 'background') return !isEmptyBackground(background)
  return true
}

/**
 * 實際要看的子分頁：選的那一個不存在就看「任務」。畫面照這個畫；寫入時和選的不一樣就寫回「任務」，
 * 那一頁之後再出現也不會自己切回去
 */
export function shownSubtab(chosen: Subtab, sources: SubtabSources): Subtab {
  return isPresent(chosen, sources) ? chosen : DEFAULT_SUBTAB
}

/** 一個子分頁現在的樣子：沒有內容（`undefined`）就不畫它的分頁籤；`count` 是分頁籤上的數字 */
type SubtabState = { count?: string; isRunning: boolean }

/**
 * 三份 view 裡分頁籤要用的部分（任務、路線圖、背景各自的 view 都滿足它）。
 * 任務的 `isRunning` 是任務板上有沒有進行中的任務或 subagent
 */
export type SubtabViews = {
  tasks: { main: { total: number; doneCount: number }; agentCount: number; isRunning: boolean }
  roadmap: { rows: readonly { kind: string }[] }
  background: { openCount: number; isRunning: boolean }
}

/**
 * 存在的子分頁各自寫什麼：路線圖寫列出的 effort 數（一個都沒列時不寫 0）；
 * 任務寫主清單的進度，主對話沒有任務時寫 subagent 數；背景寫還沒結束的數（排程也算）
 */
function statesOf(sources: SubtabSources, { tasks, roadmap, background }: SubtabViews): Partial<Record<Subtab, SubtabState>> {
  const listed = roadmap.rows.filter(r => r.kind === 'effort').length
  const positive = (n: number) => (n > 0 ? String(n) : undefined)
  return {
    tasks: {
      count: tasks.main.total > 0 ? `${tasks.main.doneCount}/${tasks.main.total}` : positive(tasks.agentCount),
      isRunning: tasks.isRunning,
    },
    ...(isPresent('roadmap', sources) ? { roadmap: { count: positive(listed), isRunning: false } } : {}),
    ...(isPresent('background', sources) ? { background: { count: positive(background.openCount), isRunning: background.isRunning } } : {}),
  }
}

/** 有東西在跑的子分頁，分頁籤後面加這個 */
export const RUNNING_MARK = '●'

/** 分頁籤的一段：名稱、數字（窄時拿掉）與有沒有東西在跑；`text` 是整段的字（算寬度用） */
export type SubtabSegment = TabSegment<Subtab> & { label: string; count?: string; isRunning: boolean }

export type SubtabBar = {
  /** 現在畫的子分頁：選的那一個沒有內容時是「任務」 */
  shown: Subtab
  /** 分頁籤那一行的段落；只剩「任務」時沒有（整行不畫，和沒有子分頁時一樣） */
  segments?: SubtabSegment[]
  /** 那一行頭尾各留幾格 */
  edge: number
}

/**
 * 排出 [任務] 的子分頁籤：存在與否看原始狀態（`shownSubtab` 同一條規則），數字與 `●` 看三份 view。
 * 不存在的不畫；只剩「任務」時整行不畫。寬度放不下 `columns` 格時拿掉數字，只留名稱與 `●`。
 */
export function subtabBar(chosen: Subtab, sources: SubtabSources, views: SubtabViews, columns: number): SubtabBar {
  const states = statesOf(sources, views)
  const present = SUBTABS.filter(t => states[t.id] !== undefined)
  const shown = shownSubtab(chosen, sources)
  if (present.length <= 1) return { shown, edge: 0 }
  const labelOf = (t: (typeof SUBTABS)[number], withCount: boolean) => {
    const s = states[t.id]
    const count = withCount && s?.count !== undefined && s.count !== '' ? s.count : undefined
    return { count, text: [t.label, ...(count === undefined ? [] : [count]), ...(s?.isRunning ? [RUNNING_MARK] : [])].join(' ') }
  }
  const build = (withCount: boolean) => {
    const parts = present.map(t => ({ t, ...labelOf(t, withCount) }))
    const bar = tabBar(
      parts.map(p => ({ id: p.t.id, label: p.text, hotkey: p.t.hotkey })),
      shown,
    )
    const segments = bar.segments.map((s): SubtabSegment => {
      const p = parts.find(q => q.t.id === s.id)
      return { ...s, label: p?.t.label ?? '', count: s.kind === 'sep' ? undefined : p?.count, isRunning: s.kind !== 'sep' && (states[s.id]?.isRunning ?? false) }
    })
    return { segments, width: bar.width, edge: bar.edge }
  }
  const full = build(true)
  return { shown, ...(full.width <= columns ? full : build(false)) }
}

