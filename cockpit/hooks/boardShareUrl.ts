/**
 * [討論版] 開啟分享前的網址驗證。這是信任邊界：通過的字串會交給 `explorer.exe`，它收到本機路徑時會開啟或執行那個檔案。
 * 整個字串都要符合白名單，不解析、不解碼：解析器對 `@`、反斜線、編碼字元的解讀和瀏覽器不一定相同，看不懂的一律不開。
 */

/** 主機與連接埠：網域或 IPv4，或方括號裡的 IPv6。不接受帳號欄位（`user@host`） */
const HOST = String.raw`(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?`
const SERVER_FORM = new RegExp(String.raw`^https?://(${HOST})/?$`)
/** 代碼只有英數、`-`、`_`，沒有 `.`、`%`、反斜線，也不能帶查詢字串或片段；資料夾的網址結尾可以有 `/` */
const SHARE_FORM = new RegExp(String.raw`^https?://(${HOST})/s/[A-Za-z0-9_-]+/?$`)

/** 這個網址是不是討論版伺服器（`server`）上的分享網址 */
export function isBoardShareUrl(url: unknown, server: string | null): url is string {
  if (typeof url !== 'string' || server === null) return false
  const host = SHARE_FORM.exec(url)?.[1]
  const expected = SERVER_FORM.exec(server)?.[1]
  return host !== undefined && expected !== undefined && host.toLowerCase() === expected.toLowerCase()
}
