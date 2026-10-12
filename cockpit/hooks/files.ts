/**
 * 面板讀寫檔案的方式，只有這一種：路線圖、SKILL 的原文、教學與常用 prompt 都透過它。
 * 正式用引擎的 `$.fs`（在 `register.tsx` 包成 `Files`），測試用記憶體裡的假檔案。
 * 路徑怎麼接、讀不到算什麼，都收在這裡，各功能不必各自決定。
 */

/** 目錄裡的一個項目；`size` 與 `mtimeMs` 只有一般檔案有意義 */
export type FileEntry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number; size?: number }

/**
 * - `read`：檔案不存在或讀不到時是 undefined，不丟例外。
 * - `list`：目錄不存在或列不出來時是空的，不丟例外。
 * - `write`：連同目錄一起建立；寫不進去會丟例外，由呼叫端決定怎麼跟使用者說。
 */
export type Files = {
  read: (path: string) => Promise<string | undefined>
  list: (path: string) => Promise<readonly FileEntry[]>
  write: (path: string, text: string) => Promise<void>
}

/** 引擎那一側的檔案操作：讀不到、列不出來都會丟例外 */
export type RawFiles = {
  read: (path: string) => Promise<string>
  list: (path: string) => Promise<readonly FileEntry[]>
  write: (path: string, text: string) => Promise<void>
}

/** 用 / 分隔，去掉結尾的 /（引擎與 `installPath` 在 Windows 上給的是反斜線的絕對路徑） */
export const tidy = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** 是不是絕對路徑（`/…`、`C:/…`、`~/…`） */
export const isAbsolute = (path: string) => /^(?:[\\/]|[A-Za-z]:|~)/.test(path)

/** `path` 在 `root` 底下的完整路徑；已經是絕對路徑，或沒有 `root`（問不到專案根目錄）時照原樣 */
export const under = (root: string | undefined, path: string) =>
  root === undefined || root === '' || isAbsolute(path) ? tidy(path) : `${tidy(root)}/${tidy(path)}`

/** 把會丟例外的檔案操作包成 `Files` */
export function safeFiles(raw: RawFiles): Files {
  return {
    read: path => raw.read(path).catch(() => undefined),
    list: path => raw.list(path).catch(() => []),
    write: raw.write,
  }
}

/**
 * 相對路徑一律接在 `root` 底下的 `Files`。
 * 引擎的相對路徑跟著工作目錄走，shell `cd` 到別處就讀不到專案的檔案；專案裡的東西都要從這裡讀。
 */
export function rootedAt(files: Files, root: string | undefined): Files {
  return {
    read: path => files.read(under(root, path)),
    list: path => files.list(under(root, path)),
    write: (path, text) => files.write(under(root, path), text),
  }
}
