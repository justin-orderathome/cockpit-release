/**
 * 範本：作者放在 plugin 底下 `templates/` 的常用 prompt 與 SKILL 覆寫，同事按「套用範本」才進到自己的檔案。
 * 範本跟著版本發布，cockpit 不另外下載（規範 R-07）；讀檔、備份、寫回與 toast 在 `register.tsx`，
 * 這裡只有不碰引擎的規則：怎麼合併、加了幾筆、套用紀錄怎麼記。
 *
 * 套用只加不改：只加入「從沒套用過、本機也沒有」的項目，套用過後同事刪掉或改名的不再加回去。
 * 範本改了內容但名稱沒變的，同事保留自己的舊內容。
 */

/** plugin 裡範本的位置（相對 plugin 的資料夾） */
export const TEMPLATE_PROMPTS = 'templates/prompts.md'

/** 套用完的 toast：兩半各加了幾項；沒套用的那一半（plugin 沒有那個範本，或沒套用成）不寫 */
export function appliedToast(added: { prompts?: number; skills?: number }): string {
  const parts = [
    ...(added.prompts === undefined ? [] : [`${added.prompts} 筆 prompt`]),
    ...(added.skills === undefined ? [] : [`${added.skills} 項 SKILL 覆寫`]),
  ]
  return (added.prompts ?? 0) + (added.skills ?? 0) > 0 ? `範本：加了 ${parts.join('、')}` : '範本都套用過了'
}

const SUBMIT = /\s+!$/
const H1 = /^#\s+(.*)$/
const H2 = /^##\s+(.*)$/

/** 一筆 prompt 在套用紀錄裡的識別：分組＋名稱（名稱不含結尾的「 !」，改成直接送出不算改名） */
export const promptKey = (group: string, name: string): string => `prompt:${JSON.stringify([group, name])}`

const nameOf = (heading: string) => heading.trim().replace(SUBMIT, '').trim()
const isBlank = (line: string) => line.trim() === ''

/** 一個分組在檔案裡佔的行：第一個 `#` 之前的部分是不分組（title ''） */
type Section = { title: string; lines: string[] }

function sectionsOf(text: string): Section[] {
  const sections: Section[] = [{ title: '', lines: [] }]
  for (const line of text.split('\n')) {
    const h1 = H2.test(line) ? undefined : H1.exec(line)
    if (h1) sections.push({ title: (h1[1] ?? '').trim(), lines: [] })
    sections[sections.length - 1]!.lines.push(line)
  }
  return sections
}

/** 一筆範本 prompt：分組、名稱與原文（`## 名稱` 那行到下一個標題之前，去掉結尾的空行） */
type Block = { group: string; key: string; lines: string[] }

function blocksOf(sections: readonly Section[]): Block[] {
  const blocks: Block[] = []
  for (const section of sections) {
    let current: { name: string; lines: string[] } | undefined
    const flush = () => {
      if (!current) return
      const lines = [...current.lines]
      while (lines.length > 0 && isBlank(lines[lines.length - 1]!)) lines.pop()
      // 和 parsePrompts 一樣：沒有名稱或沒有內文的不算一筆
      if (current.name !== '' && lines.slice(1).some(l => !isBlank(l))) {
        blocks.push({ group: section.title, key: promptKey(section.title, current.name), lines })
      }
      current = undefined
    }
    for (const line of section.lines) {
      const h2 = H2.exec(line)
      if (h2) {
        flush()
        current = { name: nameOf(h2[1] ?? ''), lines: [line] }
      } else if (current && !H1.test(line)) current.lines.push(line)
    }
    flush()
  }
  return blocks
}

/** 本機檔案裡已經有的 prompt（有標題就算，內文空的也算有） */
function keysOf(sections: readonly Section[]): Set<string> {
  const keys = new Set<string>()
  for (const section of sections) {
    for (const line of section.lines) {
      const h2 = H2.exec(line)
      if (h2) keys.add(promptKey(section.title, nameOf(h2[1] ?? '')))
    }
  }
  return keys
}

/** 在一個分組的最後接上幾筆：接在最後一行內容後面，原本結尾的空行留著 */
function appended(lines: readonly string[], blocks: readonly Block[], hasNext: boolean): string[] {
  let end = lines.length
  while (end > 0 && isBlank(lines[end - 1]!)) end--
  const body = lines.slice(0, end)
  const tail = lines.slice(end)
  for (const block of blocks) {
    if (body.length > 0) body.push('')
    body.push(...block.lines)
  }
  // 後面還有分組時，至少隔一個空行
  if (hasNext && tail.length === 0) tail.push('')
  return [...body, ...tail]
}

export type PromptApply = {
  /** 套用後的檔案內容；沒加任何一筆時就是原本的內容 */
  text: string
  /** 這次加了幾筆 */
  added: number
  /** 新的套用紀錄：原本的加上範本裡每一筆（本機本來就有的也記，之後被刪掉也不加回） */
  applied: string[]
}

/**
 * 把範本的常用 prompt 套用到本機的 `prompts.md`。`local` 是 undefined 表示本機還沒有檔案（確認過不存在才算）。
 * 新的放在同名 `# 分組` 的最後（同名的有好幾組時放在最後一組）；本機沒有這組，就整組接在檔尾；不分組的接在第一個 `#` 之前。
 */
export function applyPromptTemplate(local: string | undefined, template: string, applied: readonly string[]): PromptApply {
  const blocks = blocksOf(sectionsOf(template.replace(/\r\n/g, '\n')))
  const record = [...new Set([...applied, ...blocks.map(b => b.key)])]
  const done = new Set(applied)

  // 本機還沒有檔案、範本也從沒套用過：直接用範本建立（範本開頭的說明一起留著）
  if (local === undefined && !blocks.some(b => done.has(b.key))) {
    return { text: template, added: new Set(blocks.map(b => b.key)).size, applied: record }
  }

  const source = local ?? ''
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const sections = sectionsOf(source.replace(/\r\n/g, '\n'))
  const have = keysOf(sections)
  const todo: Block[] = []
  for (const block of blocks) {
    if (done.has(block.key) || have.has(block.key)) continue
    have.add(block.key)
    todo.push(block)
  }
  if (todo.length === 0) return { text: source, added: 0, applied: record }

  // 依分組歸到本機最後一個同名的分組；本機沒有的分組照範本的順序接在檔尾
  const into = new Map<number, Block[]>()
  const newGroups = new Map<string, Block[]>()
  for (const block of todo) {
    const at = block.group === '' ? 0 : sections.findLastIndex(s => s.title === block.group && s !== sections[0])
    if (at >= 0) into.set(at, [...(into.get(at) ?? []), block])
    else newGroups.set(block.group, [...(newGroups.get(block.group) ?? []), block])
  }

  const lines: string[] = []
  sections.forEach((section, i) => {
    const blocks = into.get(i)
    const hasNext = i < sections.length - 1
    lines.push(...(blocks ? appended(section.lines, blocks, hasNext) : section.lines))
  })
  if (newGroups.size > 0) {
    while (lines.length > 0 && isBlank(lines[lines.length - 1]!)) lines.pop()
    for (const [group, blocks] of newGroups) {
      if (lines.length > 0) lines.push('')
      lines.push(`# ${group}`)
      blocks.forEach((block, i) => lines.push(...(i > 0 ? [''] : []), ...block.lines))
    }
    lines.push('')
  }
  return { text: lines.join(eol), added: todo.length, applied: record }
}

// ── SKILL 覆寫（skills.json）────────────────────────────────

/** plugin 裡 SKILL 覆寫範本的位置（相對 plugin 的資料夾） */
export const TEMPLATE_SKILLS = 'templates/skills.json'

/** 只加本機沒有的鍵的三個區段 */
const KEYED = ['groups', 'descriptions', 'move'] as const

/**
 * 一項 SKILL 覆寫在套用紀錄裡的識別：「區段＋鍵」（groups、descriptions、move 的鍵，hidden 的項目），
 * 或「分類＋組 id」（categories）。和 prompt 的識別用不同的前綴，不會撞在一起。
 */
export const skillKey = (...path: string[]): string => `skill:${JSON.stringify(path)}`

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

/** 讀得懂的 skills.json：最外層是物件，五個區段有寫的話型別都對（區段裡個別的值不檢查，原樣留著） */
function overridesOf(text: string): Json | undefined {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(data)) return undefined
  for (const section of KEYED) if (section in data && !isObject(data[section])) return undefined
  if ('hidden' in data && !Array.isArray(data.hidden)) return undefined
  if ('categories' in data) {
    const categories = data.categories
    if (!isObject(categories) || !Object.values(categories).every(ids => Array.isArray(ids))) return undefined
  }
  return data
}

export type SkillApply =
  /** 本機的 skills.json 讀不懂：這一半不套用、不寫回（規範 R-02） */
  | { kind: 'broken' }
  | {
      kind: 'ok'
      /** 套用後的檔案內容（cockpit 的格式）；沒加任何一項時就是原本的內容 */
      text: string
      /** 這次加了幾項 */
      added: number
      /** 新的套用紀錄：原本的加上範本裡每一項 */
      applied: string[]
    }

/**
 * 把範本的 SKILL 覆寫套用到本機的 `skills.json`。`local` 是 undefined 表示本機還沒有檔案（確認過不存在才算）。
 * - `groups`、`descriptions`、`move`：只加本機沒有的鍵。
 * - `hidden`：只加本機沒有、也沒套用過的項目（同事取消隱藏的不再藏回去）。
 * - `categories`：本機沒有的分類加進來、已有的分類接在最後；兩種都只放「本機哪個分類都還沒放」的組 id
 *   （一個組只放一個分類），每個組都放過了的新分類不加。
 * - `說明` 與其他鍵不動。有加東西時寫回的排版改成 cockpit 的格式（兩格縮排）。
 * - 本機還沒有檔案、範本也從沒套用過：整份照範本建立（`說明`、其他鍵、空的分類都帶過來）。
 * 沒裝的 skill 與組照樣加：`skills.json` 現有的規則會略過找不到的。範本讀不懂時當作沒有東西可加。
 */
export function applySkillTemplate(local: string | undefined, template: string, applied: readonly string[]): SkillApply {
  const mine = local === undefined ? {} : overridesOf(local)
  if (mine === undefined) return { kind: 'broken' }
  const theirs = overridesOf(template) ?? {}
  const done = new Set(applied)
  // 範本裡的每一項（套用紀錄要加的）
  const offered = new Set<string>()
  let added = 0
  // 本機還沒有檔案：範本的 `說明` 一起帶過來（排在最前面），同事打開檔案看得懂
  if (local === undefined && '說明' in theirs) mine.說明 = theirs.說明

  for (const section of KEYED) {
    const from = theirs[section]
    if (!isObject(from)) continue
    const to = isObject(mine[section]) ? mine[section] : {}
    for (const [key, value] of Object.entries(from)) {
      if (typeof value !== 'string') continue
      offered.add(skillKey(section, key))
      if (key in to) continue
      to[key] = value
      added++
    }
    if (Object.keys(to).length > 0) mine[section] = to
  }

  if (isStringList(theirs.hidden)) {
    const hidden = Array.isArray(mine.hidden) ? mine.hidden : []
    for (const item of theirs.hidden) {
      const key = skillKey('hidden', item)
      offered.add(key)
      if (done.has(key) || hidden.includes(item)) continue
      hidden.push(item)
      added++
    }
    if (hidden.length > 0) mine.hidden = hidden
  }

  if (isObject(theirs.categories)) {
    const categories = (isObject(mine.categories) ? mine.categories : {}) as Record<string, unknown[]>
    // 本機哪個分類已經放了的組：一個組只放一個分類，新的分類也不重複放
    const placed = new Set(Object.values(categories).flat())
    for (const [name, ids] of Object.entries(theirs.categories)) {
      if (!isStringList(ids)) continue
      const into = categories[name] ?? []
      for (const id of ids) {
        offered.add(skillKey('categories', name, id))
        if (placed.has(id)) continue
        into.push(id)
        placed.add(id)
        added++
      }
      if (into.length > 0) categories[name] = into
    }
    if (Object.keys(categories).length > 0) mine.categories = categories
  }

  // 本機還沒有檔案、範本也從沒套用過：整份照範本建立（和 prompts.md 一樣）；加了幾項、套用紀錄照上面的規則算
  const isFirst = local === undefined && ![...offered].some(key => done.has(key))
  const text = added > 0 ? `${JSON.stringify(isFirst ? theirs : mine, null, 2)}\n` : (local ?? '')
  return { kind: 'ok', text, added, applied: [...new Set([...applied, ...offered])] }
}

// ── 範本有 N 項新的 ─────────────────────────────────────────

/** 一半的比對材料：[本機的檔（沒有是 undefined）, plugin 裡的範本]；plugin 沒有這個範本就不給 */
type Pair = readonly [local: string | undefined, template: string]

/**
 * 範本裡有幾項「現在按『套用範本』會加進來」的：和套用用同一套規則算，所以套用後一定歸零。
 * 本機已有同名的（作者自己的電腦）、改了內容沒改名的都不算；本機的 skills.json 讀不懂時那一半不算。
 * 只比對 plugin 裡的範本、套用紀錄與本機的檔，不下載（規範 R-07）。
 */
export function newTemplateItems(pairs: { prompts?: Pair; skills?: Pair }, applied: readonly string[]): number {
  const prompts = pairs.prompts ? applyPromptTemplate(pairs.prompts[0], pairs.prompts[1], applied).added : 0
  const skills = pairs.skills ? applySkillTemplate(pairs.skills[0], pairs.skills[1], applied) : undefined
  return prompts + (skills?.kind === 'ok' ? skills.added : 0)
}

/** [設定] 下框線右側的範本按鈕：有新的時換成「範本有 N 項新的」（畫面上高亮），沒有時是「套用範本」 */
export const templateButtonLabel = (newItems: number): string => (newItems > 0 ? `範本有 ${newItems} 項新的` : '套用範本')
