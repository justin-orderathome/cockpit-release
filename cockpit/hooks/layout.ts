/**
 * 面板的版面：外框佔掉多少行與欄、一個分頁的行怎麼分頁、說明欄佔幾行、項目怎麼排成欄。
 * 行數與欄數的預算只在這裡算；畫面那邊只給事實（面板多大、「狀態」框有幾行、分頁列多寬）。
 */

type RowBase = {
  id: string
  /** 所屬的組（分組、subagent 群組）；一組延續到下一頁時，下一頁開頭補「<label>（續）」 */
  group?: { id: string; label: string }
  /** 這一行就是組名列 */
  isHeader?: boolean
}

/** 橫向並排在同一行裡的一格（例如一個 skill 名稱），各有自己的說明。`id` 在分頁內唯一。 */
export type Cell<T> = {
  id: string
  detail?: string
  /** 停在這一格時，接在說明欄標題後面的提示 */
  detailHint?: string
  /** 這一格佔幾格寬（由 `grid` 算出）；不給就照內容的寬度 */
  width?: number
  value: T
}

/** 整行只有一樣東西的一行 */
export type PlainRow<T> = RowBase & {
  /** 滑鼠移到這一行時，說明欄顯示的完整內容 */
  detail?: string
  /** 滑鼠移到這一行時，接在說明欄標題後面的提示；沒有說明的行不會顯示 */
  detailHint?: string
  value: T
  cells?: undefined
}

/** 橫向並排幾格的一行，用 `gridRows` 產生 */
export type GridRow<T> = RowBase & { cells: readonly Cell<T>[] }

/** B 區的一行。`id` 在分頁內唯一：畫面上的 key 用它，說明欄也用它對應。 */
export type Row<T> = PlainRow<T> | GridRow<T>

/** 面板的大小，以及要停在哪一頁。 */
export type Frame = {
  /** 面板內容的總行數（Pane 的 bodyRows） */
  bodyRows: number
  /** 「狀態」框裡有幾行內容（不含框線） */
  stateRows: number
  /** 分頁列嵌在下方框的上框線上（`chrome` 的結果）；否則另外佔框上方的一行 */
  isTabsOnBorder: boolean
  /** 面板在輸入框上方（inline）時，下方框裡最多 `inlineRows` 行 */
  isInline: boolean
  inlineRows: number
  /** 下方框裡固定在頂端與底端、不分頁的行數 */
  fixedRows: number
  /** 使用者翻到的頁（從 0 起） */
  page: number
  /** 要跟隨的行；找得到就翻到它那一頁，優先於 `page` */
  followId?: string
}

export type Line<T> =
  | { kind: 'row'; row: PlainRow<T>; scope?: string }
  /** 橫向並排的一行：左邊縮排 `indent` 格、格與格隔 `gap` 格，每一格前面先畫 `mark` */
  | {
      kind: 'cells'
      row: GridRow<T>
      cells: readonly (Cell<T> & { scope?: string })[]
      indent: number
      gap: number
      mark: string
    }
  | { kind: 'continued'; key: string; label: string }

export type Layout<T> = {
  /** 這一頁的行；有說明的行（或格）附上 hover scope，說明欄的卡片用同一個 scope */
  lines: Line<T>[]
  page: number
  pageCount: number
  /** 說明欄的文字行數（另有一行標題）；0 表示這一頁不顯示說明欄 */
  detailRows: number
  /** 每一份說明；`hint` 是停在它上面時接在標題後面的提示 */
  details: { id: string; scope: string; text: string; hint?: string }[]
}

/**
 * 外框：上方的「狀態」框與下方的框各有上下兩條框線；框線與框內的間隔，左右各佔兩欄。
 * 分頁列嵌在下方框的上框線上、翻頁鍵嵌在下框線上，都不另外佔行。
 */
const FRAME_ROWS = 2
const FRAME_COLUMNS = 4

/** 橫向排成幾欄的行：左邊縮排、每格前面的定位符號（連同後面的空白）、欄與欄的間隔，以及欄的大小 */
const GRID = { indent: 2, mark: '› ', gap: 2, minColumn: 18, maxColumns: 5 }

/** 面板寬 `bodyColumns` 欄時，框內可用幾欄，以及寬 `tabsWidth` 格的分頁列放不放得上框線。 */
export function chrome(bodyColumns: number, tabsWidth: number): { columns: number; isTabsOnBorder: boolean } {
  return {
    columns: Math.max(10, bodyColumns - FRAME_COLUMNS),
    isTabsOnBorder: tabsWidth <= bodyColumns - FRAME_COLUMNS,
  }
}

/** 說明欄的文字行數：B 區夠高才顯示，放不下就不顯示（列上的名稱照樣有） */
const detailRowsFor = (room: number) => (room >= 14 ? 5 : room >= 10 ? 3 : 0)

type Page<T> = { lines: Line<T>[]; hasDetail: boolean }

/**
 * 依序把行裝進每頁 `capacity` 行。一頁裡有說明的行時，說明欄（標題加文字）也算進這一頁；
 * 一組從這頁延續到下一頁時，下一頁開頭補「（續）」，也算一行。每頁至少放一行原本的內容。
 */
function pack<T>(rows: readonly Row<T>[], capacity: number, detailCost: number): Page<T>[] {
  const pages: Page<T>[] = []
  let page: Page<T> = { lines: [], hasDetail: false }
  let used = 0
  const hasDetail = (row: Row<T>) =>
    row.cells !== undefined ? row.cells.some(c => c.detail !== undefined) : row.detail !== undefined
  const costOf = (row: Row<T>) => 1 + (detailCost > 0 && hasDetail(row) && !page.hasDetail ? detailCost : 0)
  for (const row of rows) {
    if (page.lines.length > 0 && used + costOf(row) > capacity) {
      pages.push(page)
      page = { lines: [], hasDetail: false }
      used = 0
    }
    // 第一頁的開頭不會是組的中間，只有換頁後才需要「（續）」
    if (page.lines.length === 0 && pages.length > 0 && row.group !== undefined && !row.isHeader && capacity > 1) {
      page.lines.push({ kind: 'continued', key: `continued-${pages.length}-${row.group.id}`, label: row.group.label })
      used += 1
    }
    used += costOf(row)
    page.lines.push(
      row.cells !== undefined
        ? { kind: 'cells', row, cells: row.cells, indent: GRID.indent, gap: GRID.gap, mark: GRID.mark }
        : { kind: 'row', row },
    )
    if (detailCost > 0 && hasDetail(row)) page.hasDetail = true
  }
  if (page.lines.length > 0 || pages.length === 0) pages.push(page)
  return pages
}

export function layout<T>(rows: readonly Row<T>[], frame: Frame): Layout<T> {
  // 扣掉「狀態」框（內容加框線）、下方框的框線，以及放不上框線時另外佔一行的分頁列
  const outside = frame.stateRows + FRAME_ROWS + FRAME_ROWS + (frame.isTabsOnBorder ? 0 : 1)
  const fit = Math.max(3, frame.bodyRows - outside)
  const room = frame.isInline ? Math.min(frame.inlineRows, fit) : fit
  const detailRows = detailRowsFor(room)
  // 說明欄是一行標題加文字
  const detailCost = detailRows > 0 ? detailRows + 1 : 0
  const pages = pack(rows, Math.max(1, room - frame.fixedRows), detailCost)

  const followed =
    frame.followId === undefined
      ? -1
      : pages.findIndex(p => p.lines.some(l => l.kind !== 'continued' && l.row.id === frame.followId))
  const at = Math.max(0, Math.min(pages.length - 1, followed >= 0 ? followed : frame.page))
  const current = pages[at] ?? { lines: [], hasDetail: false }

  let n = 0
  const details: Layout<T>['details'] = []
  const scopeFor = (id: string, text: string | undefined, hint: string | undefined) => {
    if (text === undefined || detailRows === 0) return undefined
    // scope 只需要在這一頁裡分得開，用序號就不會因為名稱太長而撞在一起
    const scope = `detail-${n++}`
    details.push(hint === undefined ? { id, scope, text } : { id, scope, text, hint })
    return scope
  }
  const lines = current.lines.map((l): Line<T> => {
    if (l.kind === 'continued') return l
    if (l.kind === 'cells') {
      const cells = l.cells.map(c => {
        const scope = scopeFor(c.id, c.detail, c.detailHint)
        return scope === undefined ? c : { ...c, scope }
      })
      return { ...l, cells }
    }
    const scope = scopeFor(l.row.id, l.row.detail, l.row.detailHint)
    return scope === undefined ? l : { ...l, scope }
  })
  return { lines, page: at, pageCount: pages.length, detailRows: details.length > 0 ? detailRows : 0, details }
}

/**
 * 把一組項目排成等寬的幾欄（排法見 `grid`），每一行是一個 Row。`width` 是整行可用的寬度。
 * `cell` 拿到項目與它的名稱可以用的寬度（已扣掉縮排與定位符號），回傳要畫的東西；名稱太長由它裁切。
 */
export function gridRows<I, T>(
  items: readonly I[],
  width: number,
  spec: {
    /** 這一組行的 id 前綴：第 n 行是 `<rowId>-<n>` */
    rowId: string
    group?: { id: string; label: string }
    id: (item: I) => string
    labelWidth: (item: I) => number
    detail: (item: I) => string | undefined
    /** 接在說明欄標題後面的提示；不給就沒有 */
    detailHint?: (item: I) => string | undefined
    cell: (item: I, labelWidth: number) => T
  },
): GridRow<T>[] {
  const mark = textWidth(GRID.mark)
  const lines = grid(items, item => mark + spec.labelWidth(item), Math.max(4, width - GRID.indent), GRID)
  return lines.map((line, i) => ({
    id: `${spec.rowId}-${i}`,
    group: spec.group,
    cells: line.map(({ item, width: w }) => ({
      id: spec.id(item),
      detail: spec.detail(item),
      detailHint: spec.detailHint?.(item),
      width: w,
      value: spec.cell(item, w - mark),
    })),
  }))
}

/**
 * 固定欄寬排列：寬 `width` 放得下幾欄就排幾欄（每欄至少 `minColumn` 格、欄與欄隔 `gap` 格、
 * 最多 `maxColumns` 欄，至少一欄），欄寬平分整行。各格由上到下、排滿一欄再換右邊一欄（像 `ls`）；
 * 比一欄還寬的往右多佔幾欄，被佔走的位置右邊那一欄跳過。行數取放得下的最少行數：
 * 佔多欄的格落在最右邊放不下時，多加一行讓它往左移，而不是裁切。
 * 回傳每一行由左到右的格與它佔的寬度；比整行還寬的由呼叫端用 `fitText` 裁到那個寬度。
 */
export function grid<T>(
  items: readonly T[],
  widthOf: (item: T) => number,
  width: number,
  { minColumn, gap, maxColumns }: { minColumn: number; gap: number; maxColumns: number },
): { item: T; width: number }[][] {
  const columns = Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minColumn + gap))))
  const column = Math.max(1, Math.floor((width - gap * (columns - 1)) / columns))
  const spanWidth = (span: number) => span * column + (span - 1) * gap
  const spans = items.map(item => Math.max(1, Math.min(columns, Math.ceil((widthOf(item) + gap) / (column + gap)))))

  /** 排成 `rows` 行；有佔多欄的格超出最右邊就排不下 */
  const place = (rows: number) => {
    const lines: { item: T; width: number }[][] = Array.from({ length: rows }, () => [])
    const taken = new Set<number>()
    // at 是由上到下、由左到右數的第幾個位置
    let at = 0
    for (const [i, item] of items.entries()) {
      while (taken.has(at)) at++
      const span = spans[i] ?? 1
      const col = Math.floor(at / rows)
      if (col + span > columns) return undefined
      for (let k = 1; k < span; k++) taken.add(at + k * rows)
      lines[at % rows]?.push({ item, width: spanWidth(span) })
      at++
    }
    return lines.filter(line => line.length > 0)
  }

  // 全部排成一欄一定放得下（每格最多佔滿整行），所以一定找得到
  for (let rows = Math.ceil(spans.reduce((n, s) => n + s, 0) / columns); rows < items.length; rows++) {
    const lines = place(rows)
    if (lines !== undefined) return lines
  }
  return items.map((item, i) => [{ item, width: spanWidth(spans[i] ?? 1) }])
}

/**
 * 一行裡各欄之間的間隔（格）。算寬度的（`roadmap.ts`、`tasks.ts`）與畫的（`register.tsx` 的 `gap`）
 * 都用這一個，兩邊才不會各寫各的。
 */
export const ROW_GAP = 1

/** 可以收合的標題：攤開是「▾ 標題」，收起是「▸ 標題」 */
export const foldLabel = (isOpen: boolean, text: string) => `${isOpen ? '▾' : '▸'} ${text}`

/** 分頁列的一段：目前的分頁只有標籤；其餘是按鈕，畫出來前面多「快捷鍵: 」；`sep` 是兩個分頁之間的分隔 */
export type TabSegment<Id> =
  | { kind: 'current'; id: Id; text: string }
  | { kind: 'button'; id: Id; text: string; hotkey: string }
  | { kind: 'sep'; id: Id; text: string }

/** 按鈕的快捷鍵畫成「2: 」，佔三格 */
const HOTKEY_PREFIX = 3
/** 分頁列頭尾各留一格 */
const TAB_BAR_EDGE = 1

/**
 * 分頁列有哪幾段、畫出來多寬。寬度由這裡的段落算，畫的那邊照段落畫，不另外算一次。
 */
export function tabBar<Id extends string>(
  tabs: readonly { id: Id; label: string; hotkey: string }[],
  current: Id,
): { segments: TabSegment<Id>[]; width: number; edge: number } {
  const segments = tabs.flatMap((t, i): TabSegment<Id>[] => [
    ...(i > 0 ? [{ kind: 'sep' as const, id: t.id, text: ' ─ ' }] : []),
    t.id === current
      ? { kind: 'current', id: t.id, text: t.label }
      : { kind: 'button', id: t.id, text: t.label, hotkey: t.hotkey },
  ])
  const width =
    TAB_BAR_EDGE * 2 + segments.reduce((n, s) => n + textWidth(s.text) + (s.kind === 'button' ? HOTKEY_PREFIX : 0), 0)
  return { segments, width, edge: TAB_BAR_EDGE }
}

/** 中日韓文字與全形符號佔兩格 */
const isWide = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6)

const cells = (c: string) => (isWide(c.codePointAt(0) ?? 0) ? 2 : 1)

/** 文字在畫面上佔幾格 */
export const textWidth = (text: string) => [...text].reduce((n, c) => n + cells(c), 0)

/** 把文字折成每行不超過 `width` 格的幾行（照格數折，不看單字邊界）；原本的換行照樣換行。 */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    let used = 0
    for (const c of paragraph) {
      if (used + cells(c) > Math.max(2, width)) {
        out.push(line)
        line = ''
        used = 0
      }
      line += c
      used += cells(c)
    }
    out.push(line)
  }
  return out
}

/** 把文字裁到 `width` 格以內，裁掉的地方補「…」。按鈕的標籤不會自己截斷，太長會折成兩行打亂行數預算。 */
export function fitText(text: string, width: number): string {
  const chars = [...text]
  if (textWidth(text) <= width) return text
  let used = 0
  let out = ''
  for (const c of chars) {
    if (used + cells(c) > Math.max(0, width - 1)) break
    used += cells(c)
    out += c
  }
  return `${out}…`
}
