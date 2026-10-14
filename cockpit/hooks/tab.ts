import type { EngineInterface } from 'claude-code'

import type { Row } from './layout'

/** 引擎給的畫面元素；有些介面沒有下拉選單或輸入框 */
export type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** 畫一個分頁需要的東西（引擎的 `$` 另外當第一個參數傳） */
export type TabContext = {
  ui: Elements
  /** 框內可用的寬度 */
  cols: number
  /** 強調色 */
  accent: string
}

/**
 * 一個分頁的內容：固定在頂端與底端的各一行（不分頁），以及中間要分頁的行。
 * 外框、分頁、說明欄與翻頁由 `register.tsx` 統一處理，分頁只管自己有哪些行。
 */
export type TabContent = {
  top?: JSX.Element
  /** `top` 佔幾行；不給就是一行（[SKILL] 有分類時多一排分頁籤） */
  topRows?: number
  bottom?: JSX.Element
  /** 這個分頁的操作按鈕：疊在下框線的左端（和右端的翻頁鍵同一條），放不下時退回框內的最後一行 */
  actions?: JSX.Element
  /** `actions` 畫出來多寬（`keysWidth` 算） */
  actionsWidth?: number
  /** 這個分頁的狀態（例如 [設定] 的版本）：疊在下框線的右端；要翻頁（翻頁鍵在那裡）或放不下時退回框內的最後一行 */
  status?: JSX.Element
  /** `status` 畫出來多寬，頭尾各一格算在內 */
  statusWidth?: number
  rows: Row<JSX.Element>[]
  /** 一行都沒有時顯示的話 */
  emptyText?: string
  /** 要自動翻到的那一行 */
  followId?: string
}
