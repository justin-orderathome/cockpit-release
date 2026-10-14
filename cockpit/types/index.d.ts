export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type TaskItem = {
  id: string
  /** 來源：TodoWrite 清單，或 TaskCreate / TaskUpdate */
  source: 'todo' | 'task'
  /** 已去掉 (~Nm) 標記的任務名稱 */
  title: string
  status: TaskStatus
  /** 模型在名稱後附的預估毫秒數；沒附則無 */
  estimateMs?: number
  /** 轉為進行中的時間（epoch ms） */
  startedAt?: number
  /** 完成的時間（epoch ms） */
  doneAt?: number
  /** 使用者按 × 隱藏 */
  isDismissed: boolean
  /** 這份清單屬於哪個 subagent；主對話為 undefined */
  agentId?: string
}

/** 一個 subagent 的清單，掛在派出它的那個任務底下 */
export type AgentGroup = {
  id: string
  /** 派工時給的簡短描述 */
  label: string
  /** 第一次看到它的清單時，派出者正在進行的任務；找不到則 undefined */
  parentTaskId?: string
  isDismissed: boolean
}

/** [任務] 的全部狀態，一起更新 */
export type TaskBoard = {
  /** 這個 session 的任務，依模型寫入的順序 */
  tasks: TaskItem[]
  /** 出現過清單的 subagent，依先後順序 */
  agents: AgentGroup[]
  /** 是否自動翻到最近開始的進行中任務 */
  isFollowing: boolean
}

export type Tab = 'tasks' | 'basic' | 'skill' | 'settings'

/** 票的種類：地圖底下的決策票，或 /to-tickets 拆出來的實作票 */
export type TicketKind = 'decision' | 'build'

/** 結案、已認領、可接手、待人處理（`ready-for-human`），或在等（被卡住、待分類） */
export type TicketState = 'done' | 'claimed' | 'takeable' | 'human' | 'waiting'

/** `<放 effort 的目錄>/<effort>/issues/` 底下的一張票 */
export type Ticket = {
  /** 檔名開頭的編號，例如 `03` */
  number: string
  /** 相對於專案根目錄的路徑 */
  path: string
  title: string
  kind: TicketKind
  state: TicketState
  /** 還沒結案、卡住這張票的編號 */
  waitingOn: string[]
  /** 票的問題（`## Question`）或要做的內容（`**What to build:**`） */
  detail?: string
}

/** effort 走到哪：找路中、待寫規格、待拆票、實作中、已完成、零散 */
export type EffortStage = 'mapping' | 'needsSpec' | 'needsTickets' | 'building' | 'done' | 'loose'

/** 專案放 effort 的目錄（預設 `.scratch/`）底下的一件工作 */
export type Effort = {
  name: string
  /** 地圖的終點（第一行）；沒有地圖則無 */
  destination?: string
  stage: EffortStage
  decisions: Ticket[]
  builds: Ticket[]
  /** 目前階段的進度：找路中算決策票，實作中算實作票 */
  progress: { done: number; total: number }
  /** 「繼續」要填進輸入框的文字；沒有下一步則無 */
  next?: string
  /** 資料夾裡最近一次修改的時間 */
  mtimeMs: number
}

/** A 區用量的快照，來自 $.session.usage() 與 session.measure */
export type UsageSnapshot = {
  /** 上下文用量 %；第一個回應出來之前沒有 */
  contextPercent?: number
  /** 上一次回應時輸入端的 token 數；第一個回應出來之前沒有 */
  contextTokens?: number
  /** 目前模型的上下文窗口（token 數） */
  contextWindow?: number
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

/** [基本] 的一筆常用 prompt */
export type PromptEntry = {
  id: string
  name: string
  body: string
  /** 名稱結尾標了 ` !`：點了直接送出 */
  isSubmit: boolean
}

export type PromptGroup = {
  id: string
  /** '' 表示不分組 */
  title: string
  entries: PromptEntry[]
}

/** [SKILL] 的一個項目 */
export type SkillItem = {
  /** command.list 的完整名稱，填入時用 */
  name: string
  /** 顯示的名稱（plugin 組裡省略前綴） */
  label: string
  /** 一行說明：自訂短說明，或 description 的第一句 */
  summary: string
  /** 完整的 description，滑鼠停留時顯示 */
  description: string
  /** 整理好的用法；沒有，或四項都空，就沒有這個欄位 */
  howto?: Howto
  /** 用法的原料種類；只有原料是 description（找不到 SKILL.md）時才有這個欄位 */
  howtoKind?: 'description'
}

/** 一個 skill 的用法：四項各是幾條一行的文字，原文沒寫的那一項是空的 */
export type Howto = {
  /** 何時用：觸發詞與適用情境 */
  when: string[]
  /** 怎麼叫：參數與模式 */
  how: string[]
  /** 會做什麼：作者規劃的步驟或產出 */
  does: string[]
  /** 搭配：原文點名的其他 skill */
  with: string[]
}

export type SkillGroup = {
  /** plugin 名稱、來源的 `owner/repo`，或 'my-skills'、'builtin-skills' */
  id: string
  title: string
  items: SkillItem[]
}

/** ~/.claude/cockpit/skills.json */
export type SkillOverrides = {
  groups: Record<string, string>
  descriptions: Record<string, string>
  hidden: string[]
  /** 手動指定 skill 放哪一組：完整名稱或結尾 `*` 的前綴 → 組的 id */
  move: Record<string, string>
}

/** $.command.list() 的一筆，只取用得到的欄位 */
export type CommandEntry = { name: string; description: string; source: string; plugin?: string }

/** skillFrontmatter 的一筆，只取用得到的欄位 */
export type FrontmatterEntry = { name: string; source: string; pluginName?: string }

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      /** 目前的模型，與 /model 顯示的相同 */
      model: string
      /** 實際使用的深度（來自 turn.step）；'' 表示尚未得知 */
      effort: string
      /** 使用者選的深度（/effort 或設定）；'' 表示尚未得知 */
      chosenEffort: string
      /** 正在切換哪一個 Select；'' 表示閒置 */
      switching: '' | 'model' | 'effort'
      usage: UsageSnapshot
      /** 已跳過 toast 的用量（`ctx`，或 `<kind>:<resetsAt>`） */
      alerted: string[]
      /** 每 60 秒跳動一次，讓 5H 倒數重畫 */
      minute: number
      /** 任務、subagent 群組與跟隨狀態 */
      board: TaskBoard
      /** 每秒跳動一次，讓進行中任務的耗時重畫 */
      tick: number
      tab: Tab
      /** 各分頁目前的頁碼（從 0 起） */
      pages: Record<Tab, number>
      prompts: PromptGroup[]
      hasProjectPrompts: boolean
      /** 收合的 [基本] 分組 id（預設展開） */
      closedPromptGroups: string[]
      commands: CommandEntry[]
      frontmatter: FrontmatterEntry[]
      overrides: SkillOverrides
      /** 用 `npx skills add -g` 裝的 skill 的來源：skill 名稱 → `owner/repo`（取自 `~/.agents/.skill-lock.json`） */
      skillSources: Record<string, string>
      /** 展開的 [SKILL] 組 id（預設收合） */
      openSkillGroups: string[]
      search: string
      /** 目前專案的 effort，最近修改的在前 */
      roadmap: Effort[]
      /** 展開的 effort 名稱 */
      openEfforts: string[]
      /** 路線圖裡手動攤開（true）或收起（false）過的組與「已結案」，鍵是 `<effort>/<決策|實作>` 或再加 `/已結案` */
      roadmapFolds: Record<string, boolean>
      /** 是否顯示已完成的 effort */
      showDoneEfforts: boolean
      /** 上次查到的發布版本，留著的標示看它；'' 表示還沒查到過。也存在 $.store */
      releasedVersion: string
      /** 已經下載、還沒換上的版本，標示是不是「已下載」看它；'' 表示沒有。也存在 $.store */
      downloadedVersion: string
      /** SKILL 說明的繁體中文翻譯，鍵是 command.list 的完整名稱；也存在 $.store */
      translations: Record<string, { source: string; summary: string; description: string }>
      /**
       * SKILL 用法的快取，鍵是 command.list 的完整名稱；也存在 $.store。
       * `source` 是原文的雜湊，`version` 是 prompt 版本；沒有 `howto` 的是「格式不對」的失敗記號
       */
      howtos: Record<string, { source: string; version: number; kind: 'skill' | 'description'; howto?: Howto }>
      /** 這一輪用法的整理是否還在跑 */
      makingHowtos: boolean
      /** [SKILL] 的「更新用法」是否展開成「快速／重整」的選擇 */
      howtoMenu: boolean
      /**
       * 用法頁上那個 skill 的教學狀態：`unavailable` 是找不到 SKILL.md（沒有教學可產），
       * `none` 是還沒產生，`fresh` 是最新的，`stale` 是原文更新過。打開用法頁時才去看檔案。
       */
      tutorial: { name: string; status: 'unavailable' | 'none' | 'fresh' | 'stale' }
      /** 正在產生哪一個 skill 的教學（完整名稱）；'' 表示沒有 */
      makingTutorial: string
      /** 用法頁的「重新產生」是否展開成「覆蓋」的確認 */
      tutorialMenu: boolean
      /** 正在看哪一個 skill 的用法頁（完整名稱）；'' 表示在列表 */
      howtoPage: string
    }
  }
}
