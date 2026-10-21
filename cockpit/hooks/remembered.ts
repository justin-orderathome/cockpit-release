import type { Tab } from '../types'
import { TABS } from './config'
import type { Settings } from './config'
import type { Translations } from './translate'

/**
 * 跨 session 記住的面板狀態：哪些東西存進 `$.store`、讀回來時怎麼驗、開場時怎麼用。
 * 存與讀的動作在 `register.tsx`（`$` 只能留在那裡）；這裡是不碰引擎的規則，可以直接測。
 *
 * `$.store` 的鍵（全部）：
 * - `openEfforts`、`openSkillGroups`、`closedPromptGroups`：收合狀態，字串清單。
 * - `skillCategory`：[SKILL] 選中的分類名稱，字串；不是字串當作沒選（看第一個分類）。
 * - `lastTab`：上次停在哪個分頁（[設定] 不記）。
 * - `translations`、`howtos`：模型產生的快取（`howtos` 的驗證在 `howto.ts`）。
 * - `appliedTemplate`：套用過的範本項目（全域），字串清單，用 `storedList` 驗；常用 prompt 與 SKILL 覆寫共用，
 *   識別怎麼寫在 `templates.ts`（`promptKey`、`skillKey`）。
 *   [設定] 算「範本有 N 項新的」要讀，所以依 ADR 0002 有一個 atom：開場讀回，「套用範本」時先讀 store 最新的、存回後換上。
 * - `skillCalls`：skill 的叫用紀錄（全域，開始記錄日與每個 skill 的次數、最後一次的日期），驗證與加一次在 `skillCalls.ts`。
 * - 更新用的 `seenVersion`、`reloadingAt`、`checkedAt`、`releasedVersion`、`downloadedVersion`、`notifiedVersion`：
 *   只有 `updater.ts` 讀寫，各鍵的意思寫在那裡。
 *
 * 只記這個 session 的（不在這裡）：路線圖裡票的收合、是否顯示已完成的 effort、搜尋字串、翻到第幾頁、
 * 在等你（`waiting`：等你決定的對話框與輪到你的開始時刻，見 `waiting.ts`）、
 * 正在用的 skill（`skillInUse`：主對話與各 subagent 的，見 `skillCalls.ts`）。
 */

/** 存起來的字串清單；形狀不對是 undefined（維持預設），混進別的型別的項目丟掉 */
export const storedList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : undefined

/** 把 id 加入清單，已經在裡面就拿掉 */
export const toggled = (list: readonly string[], id: string): string[] =>
  list.includes(id) ? list.filter(x => x !== id) : [...list, id]

const isText = (v: unknown): v is string => typeof v === 'string'

/**
 * 存起來的一個字串：版本號（`releasedVersion`、`downloadedVersion`）或 [SKILL] 的分類名稱（`skillCategory`）。
 * 沒存過或形狀不對是空的，就是沒有（版本當作沒記、分類當作沒選，看第一個分類）。
 */
export const storedText = (value: unknown): string => (isText(value) ? value : '')

/** 存起來的翻譯；形狀不對的整筆丟掉，下次再翻 */
export function storedTranslations(value: unknown): Translations {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const kept: Translations = {}
  for (const [name, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== 'object') continue
    const { source, summary, description } = entry as Record<string, unknown>
    if (isText(source) && isText(summary) && isText(description)) kept[name] = { source, summary, description }
  }
  return kept
}

/** 開場停在哪個分頁：設定指定的那一個；設成「上次」時用存起來的，沒有、不認得或是 [設定] 就回到 [任務] */
export function startTab(defaultTab: Settings['defaultTab'], last: unknown): Tab {
  if (defaultTab !== 'last') return defaultTab
  const known = TABS.find(t => t.id === last)?.id
  return known !== undefined && known !== 'settings' ? known : 'tasks'
}

/** 按了「重新載入 mod」之後多久內的 session.start 算是它造成的（毫秒） */
export const RELOAD_WINDOW = 30_000

/** 這次開場是不是剛按「重新載入 mod」造成的；`at` 是存起來的時間，沒按過不是數字 */
export const justReloaded = (at: unknown, now: number): boolean => typeof at === 'number' && now - at < RELOAD_WINDOW

/** 這次開場的版本和上次記得的不一樣（升版或退版）；第一次開、或讀不到版本時不算 */
export const versionChanged = (seen: unknown, current: string): boolean =>
  typeof seen === 'string' && current !== '' && seen !== current
