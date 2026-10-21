import type { PromptEntry, PromptGroup } from '../types'

const SUBMIT = /\s+!$/

/**
 * 解析 prompts.md：`# 分組`、`## 名稱`，`##` 底下到下一個標題之間的內文就是 prompt。
 * 名稱結尾的 ` !` 表示直接送出；第一個 `#` 之前就出現的 `##` 放在不分組（title ''）。
 * `scope` 讓全域與本專案的 id 不會撞在一起。
 */
export function parsePrompts(markdown: string, scope: string): PromptGroup[] {
  const groups: PromptGroup[] = []
  let group: PromptGroup | undefined
  let entry: { name: string; lines: string[] } | undefined

  const flush = () => {
    if (!entry) return
    const name = entry.name.replace(SUBMIT, '').trim()
    const body = entry.lines.join('\n').trim()
    if (!group) {
      group = { id: `${scope}:`, title: '', entries: [] }
      groups.push(group)
    }
    const item: PromptEntry = {
      id: `${group.id}:${group.entries.length}`,
      name,
      body,
      isSubmit: SUBMIT.test(entry.name),
    }
    if (name !== '' && body !== '') group.entries.push(item)
    entry = undefined
  }

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const h2 = /^##\s+(.*)$/.exec(line)
    const h1 = h2 ? undefined : /^#\s+(.*)$/.exec(line)
    if (h1) {
      flush()
      const title = (h1[1] ?? '').trim()
      group = { id: `${scope}:${title}`, title, entries: [] }
      groups.push(group)
    } else if (h2) {
      flush()
      entry = { name: (h2[1] ?? '').trim(), lines: [] }
    } else if (entry) {
      entry.lines.push(line)
    }
  }
  flush()
  return groups.filter(g => g.entries.length > 0)
}

/** 本專案的分組接在全域清單後面，組名加上「本專案」。 */
export function withProject(global: PromptGroup[], project: PromptGroup[]): PromptGroup[] {
  return [...global, ...project.map(g => ({ ...g, title: g.title === '' ? '本專案' : `本專案：${g.title}` }))]
}

/** `[ 編輯 ]` 找不到檔案時建立的範例。 */
export const SAMPLE_PROMPTS = `<!--
cockpit 的常用 prompt。
格式：「# 分組」、「## 名稱」，名稱底下到下一個標題之間的內文就是 prompt，可以多行。
名稱結尾加「 !」的，點了會直接送出；其餘會填進輸入框。
slash command 也可以寫成一筆，例如 /mattpocock-skills:wayfinder
可用的變數（填入或送出時換成當下的值；取不到就留原字、不送出）：
  {{票}}    主對話最近經手的那一張票（相對於專案根目錄的路徑）
  {{分支}}  目前的 git 分支名稱（detached HEAD 或不在 git repo 就算取不到）
-->

# 票
## 接手這張票
接手 {{票}}，先讀票與規格書，說明你打算怎麼做。

# 審查
## review diff
請 review 目前未 commit 的變更，只列出真正的問題。

## 找 bug
這段程式在什麼輸入下會出錯？

# 收尾
## commit 訊息 !
依照目前的變更寫一則繁體中文 commit 訊息，先給我看，不要 commit。
`
