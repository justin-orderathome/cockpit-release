/**
 * 更新紀錄：檔案放在哪裡、長什麼格式、怎麼找一版的條目、詢問裡列哪幾版、怎麼接在問句後面，以及沒有這個檔時說什麼。
 * 讀檔與開檔在 `register.tsx`（`$` 只能留在那裡）；這裡是不碰引擎的規則，可以直接測。
 *
 * 格式：每版一個二級標題，標題剛好是版本號；底下每條以 `- ` 或 `* ` 開頭，縮排接著寫的併進同一條。
 * 「標題剛好是版本號才算那一版的條目」這條規則有兩份：這裡的 `notesBetween`，以及發布指令
 * `scripts/publish.mjs` 的 `hasChangelogEntry`（發布前檢查有沒有這一版）。發布指令只用 Node 內建的模組、
 * 不匯入這裡，所以改其中一份時另一份要跟著改。
 */

import { tidy } from './files'
import { isOlder } from './release'

/** 更新紀錄的檔名：原始碼 repo 根目錄一份，跟著發布放在 plugin 的資料夾裡 */
export const CHANGELOG = 'CHANGELOG.md'

/** 裝著的那一份更新紀錄（`root` 是 plugin 的資料夾） */
export const changelogIn = (root: string): string => `${tidy(root)}/${CHANGELOG}`

/** 發布的那一份更新紀錄：在 clone 裡、`releasedManifest` 給的 plugin.json 所在的 plugin 資料夾 */
export const changelogBeside = (manifest: string): string => manifest.replace(/\.claude-plugin\/plugin\.json$/, CHANGELOG)

/**
 * 從更新紀錄的文字挑出 `after` 之後、到 `upTo` 為止每一版的條目，從新到舊。
 * 退版（`upTo` 比 `after` 舊）時範圍是空的；讀不到檔、版本號比不出來也是空的。
 */
export function notesBetween(text: string | undefined, after: string, upTo: string): string[] {
  if (!isOlder(after, upTo)) return []
  const sections: { version: string; notes: string[] }[] = []
  let notes: string[] | undefined
  for (const line of (text ?? '').split(/\r?\n/)) {
    const version = /^##\s+(.+?)\s*$/.exec(line)?.[1]
    const item = /^[-*]\s+(.+?)\s*$/.exec(line)?.[1]
    if (line.startsWith('#')) {
      // 範圍外的版本（含標題不是版本號的那幾段）底下的條目不收
      notes = undefined
      if (version !== undefined && isOlder(after, version) && !isOlder(upTo, version)) sections.push({ version, notes: (notes = []) })
    } else if (item !== undefined) notes?.push(item)
    else if (/^\s+\S/.test(line) && notes && notes.length > 0) notes.push(`${notes.pop()} ${line.trim()}`)
  }
  return sections.sort((a, b) => (isOlder(a.version, b.version) ? 1 : isOlder(b.version, a.version) ? -1 : 0)).flatMap(s => s.notes)
}

/** 詢問裡最多列幾條更新紀錄 */
export const NOTES_SHOWN = 6

/** 把更新紀錄的條目接在問句後面；超過 `NOTES_SHOWN` 條的不列，最後加一行請使用者去看更新紀錄 */
export function withNotes(question: string, notes: readonly string[]): string {
  if (notes.length === 0) return question
  const shown = notes.slice(0, NOTES_SHOWN).map(note => `・${note}`)
  return [question, '', ...shown, ...(notes.length > NOTES_SHOWN ? ['其餘見更新紀錄'] : [])].join('\n')
}

/** [設定] 的「更新紀錄」：裝著的那一版沒有這個檔時說的話 */
export const NO_CHANGELOG = '這一版沒有更新紀錄'
