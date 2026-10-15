/**
 * 面板為了少問引擎、少讀檔而記在模組裡的東西，以及重新載入畫面的資料時各要忘掉哪些。
 * 重新載入有兩種：session 開始，與 `/clear`（換了 session id、`$.state` 清空，但不會再來一次 session.start）。
 * `/clear` 不換專案也不換使用者，所以只忘掉跟著 `$.state` 一起清空的「畫面上是什麼」；
 * 問過的目錄、整理過一輪的用法、問過沒翻成的說明照樣沿用，不重做。
 * mod 重新載入時模組整個重來，這裡的東西也一起重來。
 */

export type Reload = 'start' | 'clear'

export type SessionMemory = {
  /** 整個 session 不會變的兩個目錄：問過一次就記著。同一個物件，重新載入時在原地清掉 */
  readonly dirs: { home?: string; root?: { path: string | undefined } }
  /** 已經自動整理過一輪用法；之後要再整理由使用者按「更新用法」 */
  hasMadeHowtos: boolean
  /** 問過模型、但沒翻成的說明：不再重問（下個 session 再試）。同一個 Set，重新載入時在原地清掉 */
  readonly missedTranslations: Set<string>
  /** 內建 skill 的名稱（用量明細）已經寫上畫面 */
  hasFrontmatter: boolean
  /** 畫面上的用量（JSON）：一樣就不寫 */
  shownUsage: string | undefined
  /** 上次寫上畫面的實際深度：一樣就不必讀狀態 */
  lastEffort: string | undefined
  /** 重新載入畫面的資料之前呼叫：session 開始全部忘掉；`/clear` 只忘掉畫面上的 */
  begin: (reason: Reload) => void
}

export function sessionMemory(): SessionMemory {
  const memory: SessionMemory = {
    dirs: {},
    hasMadeHowtos: false,
    missedTranslations: new Set(),
    hasFrontmatter: false,
    shownUsage: undefined,
    lastEffort: undefined,
    begin: reason => {
      // 畫面上的跟著 $.state 清空了，記著的「上次寫的」不能再拿來省略寫入
      memory.hasFrontmatter = false
      memory.shownUsage = undefined
      memory.lastEffort = undefined
      if (reason === 'clear') return
      delete memory.dirs.home
      delete memory.dirs.root
      memory.hasMadeHowtos = false
      memory.missedTranslations.clear()
    },
  }
  return memory
}
