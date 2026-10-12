# cockpit

Claude Code 的右側面板 mod。上方的「狀態」框顯示用量、目前的模型與思考深度，下方的框用四個分頁放任務進度、常用 prompt、skill 清單與設定。

```
╭─ 狀態 ─────────────────────────────────────────────────────╮
│ CTX 54%  ██░░ 544k/1M   5H 23%  █░░░ 2h10m   WK 12%  ░░░░  │
│ 模型 opus ▾   深度 high ▾                                  │
╰────────────────────────────────────────────────────────────╯
╭─ 任務 3/5 ─ 2: 基本 ─ 3: SKILL ─ 4: 設定 ──────────────────╮
│ 3/5 完成 · 還需約 4m                         c: 清除已完成 │
│ ✓ 讀取設定檔                                          1m × │
│ ● 實作分頁                            ███░░░  52%    ~2m × │
│ ○ 寫測試                                             ~3m × │
╰──────────────────────────────── k: 上頁  1/2  j: 下頁 ─────╯
```

顏色只在需要注意時出現：框線、已完成與還沒開始的項目都是暗色，強調色留給目前的分頁、進行中的項目與「繼續」。除了強調色可以自己選，其餘顏色都跟著終端機主題走。

用 Claude Code 2.1.294 的 function hooks（plugin 的 hooks module）寫成，沒有任何外部相依。

## 功能

### 上方：用量、模型與深度

- **用量**：`CTX`（上下文）、`5H`（5 小時額度）、`WK`（本週額度）。未達黃色門檻時跟一般文字同色，到黃色門檻轉成主題的警告色，到紅色門檻轉成錯誤色。用 API key 時只有 CTX。
  - 進度條後面各有一段文字：CTX 是「已用／窗口」的 token 數（`544k/1M`），5H 是重置倒數（`2h10m`），WK 是重置日期（`10-14`，電腦的當地時區）。數字都直接取自 Claude Code，跟 `/context` 與狀態列一致。
  - 面板不夠寬時，這三段文字依序隱藏：先是 WK 的日期，再來 5H 的倒數，最後 CTX 的用量。都藏了還放不下，才改成一項一行，這時文字全部顯示。面板 67 欄以上三段都看得到，62 欄時看得到前兩段。
- **模型、深度**：在用量下方的兩個下拉選單，選了就執行 `/model`、`/effort`。深度顯示實際送出的值；被模型降級時，旁邊會加灰字 `(選 max)`。
- **提醒**：任一項用量剛跨過 toast 門檻時跳一次 toast，同一個額度時段內不重複。

### 下方：四個分頁

| 分頁 | 內容 |
| --- | --- |
| **任務** | TodoWrite 與 TaskCreate／TaskUpdate 的任務清單。每列有耗時或剩餘時間，進行中的那一列另外畫進度條與百分比，超時時時間變紅；subagent 的清單掛在派出它的任務底下。會自動翻到最近開始的進行中任務。上方的「路線圖」列出本專案每個 effort 的階段與進度（見下方說明） |
| **基本** | 常用 prompt，讀自 `~/.claude/cockpit/prompts.md`。點了填進輸入框，名稱結尾標 ` !` 的會直接送出。列上只顯示名稱，滑鼠移到項目上，列表下方的說明區會顯示完整內容 |
| **SKILL** | 已安裝的 skill，依 plugin 分組，另有「我的 skill」「內建 skill」兩組；頂端有搜尋框。點了把 `/<skill 名稱> ` 填進輸入框。一組裡的 skill 名稱橫向排成等寬的幾欄，欄數隨面板寬度變（1–5 欄，每欄至少 18 格），由上到下排滿一欄再換右邊一欄，比一欄還寬的名稱多佔一欄（可在 [設定] 改回一個一行）；滑鼠移到名稱上，列表下方的說明區會顯示完整說明。說明會自動翻成繁體中文。cockpit 還會讀每個 skill 的 SKILL.md，整理成四項用法（何時用、怎麼叫、會做什麼、搭配）：有用法的 skill 名稱後面多一個 `?`，點了把列表換成用法頁，上面是說明與用法的全文，可以直接填入或返回（見下方說明）。用法頁上還可以按「教學」，讓 cockpit 把這個 skill 寫成一份詳細的繁體中文教學，在編輯器裡打開（見下方說明） |
| **設定** | 強調色、用量門檻、自動開啟等參數 |

放不下時，下方會自己分頁，翻頁鍵嵌在下框線的右端（`k: 上頁  2/5  j: 下頁`），上方的「狀態」框會一直留在畫面上。面板太窄、分頁列放不上框線時，分頁列會退回框上方的一行。

**路線圖**（[任務] 上方）：讀目前專案 `.scratch/` 底下 mattpocock-skills 的本機 tracker 檔案（`map.md`、`spec.md`、`issues/NN-*.md`；目錄可以不是 `.scratch/`，見下方「effort 放在哪」），每個 effort 一行，顯示階段、進度與「繼續」按鈕；點名稱展開看票（只列還要做的：已結案的票有 2 張以上時收成一行「▸ 已結案 N」，整組都結案的決策票或實作票只剩小計那一行，點一下攤開；手動攤開或收起的只記到這個 session 結束），點票用 VS Code 開檔，滑鼠移到票上，下方說明欄顯示它的問題或要做的內容。

| 階段 | 條件 | 「繼續」填入 |
|---|---|---|
| 找路中 | 有地圖，還有沒結案的決策票，或「Not yet specified」還有內容（整行括號的註記不算） | `/mattpocock-skills:wayfinder <map.md>` |
| 待寫規格 | 地圖已抵達，沒有 `spec.md` | `/mattpocock-skills:to-spec <map.md>` |
| 待拆票 | 有 `spec.md`，沒有實作票 | `/mattpocock-skills:to-tickets <spec.md>` |
| 實作中 | 有沒結案的實作票 | `/mattpocock-skills:implement <第一張可接手的票>`，並請它完成後把 `Status:` 改成 `resolved` |
| 已完成 | 票全部結案（預設不顯示，按「已完成 N」展開） | — |
| 零散 | 沒有地圖與規格書的票 | 有 `needs-triage` 的票時填 `/mattpocock-skills:triage` |

開頭有 `Type:`（research／prototype／grilling／task）的是決策票，其餘是實作票。實作票的 `Status:` 是 `resolved`、`done`、`wontfix`，或驗收清單全部打勾，就算結案。`Status:` 是 `ready-for-human` 的票標成「待人處理」，「繼續」會跳過它，只剩這種票時不填任何東西。agent 用 Write／Edit 改了 `.scratch/` 底下的檔案會自動重讀；用 Bash／PowerShell 改的，指令跑完後比對檔名、大小與修改時間，有變才重讀。自己在編輯器改的，按 `r` 重新讀取。

**effort 放在哪**：照專案的 `docs/agents/issue-tracker.md`（寫票的 skill 也看這份），取裡面第一個 `<目錄>/<effort>/` 這種路徑的目錄，例如寫 `docs/efforts/<effort>/map.md` 就讀 `docs/efforts/`。沒有這份文件或認不出路徑時讀 `.scratch/`；文件標題寫明是 GitHub、GitLab、Linear、Jira 這類線上的 tracker 時不顯示路線圖。目錄一律從專案根目錄找，shell `cd` 到別處不影響。

**填入輸入框的規則**（[基本] 與 [SKILL] 共用）：輸入框是空的就直接填；已經有字時，slash command 會放在最前面，原本的字變成它的參數，一般 prompt 則換一行接在後面。

### 剩餘時間怎麼算

cockpit 會在 system prompt 加一段要求，請模型在每個任務名稱後面寫上預估時間 `(~Nm)`。剩餘時間 = 預估 × 校正係數，係數是已完成任務的「實際 ÷ 預估」，限制在 0.25–4 之間。沒有預估的任務，用已完成任務的平均耗時。

## 安裝

需要 Claude Code 2.1.294 以上（用 `claude --version` 確認）。

1. 把 `cockpit` 資料夾放在本機一個固定的位置，例如 `C:\Tools\cockpit`（macOS／Linux 例如 `~/tools/cockpit`）。拿到的是 zip 就先解壓縮；資料夾的第一層要看得到 `hooks` 與 `.claude-plugin`。
2. 在 `~/.claude/settings.json`（Windows 是 `C:\Users\<你的帳號>\.claude\settings.json`）的 `env` 加上這個資料夾的路徑。檔案裡已經有 `env` 的話，把這一行加進去就好；路徑一律用正斜線：

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "C:/Tools/cockpit"
     }
   }
   ```

   原本就有別的路徑時，用系統的路徑分隔符號接在後面：Windows 是 `;`，macOS／Linux 是 `:`。

3. 重開 Claude Code。之後每個 session 都會自動載入；`claude plugin list` 會看到 `cockpit@inline`，面板沒有自己出現的話打 `/cockpit`。

只想在單一 session 試用的話，也可以用 `claude --plugin-dir C:/Tools/cockpit`。

**更新**：用新版的資料夾整個取代舊的，再重開 Claude Code。你的設定、常用 prompt 與 SKILL 覆寫都存在別的地方（`settings.json` 與 `~/.claude/cockpit/`），不會被蓋掉。

**裝之前要知道的**：

- cockpit 會在每個 session 的 system prompt 加一段要求，請模型在任務名稱後面寫上預估時間 `(~Nm)`。
- SKILL 說明的翻譯與用法的整理都會用到你的 API 用量，不需要可以在 [設定] 分別關掉。用法第一次會對每個列出的 skill 各問一次 `haiku`（幾十次），之後只有新裝的或 SKILL.md 改過的才再問。
- SKILL 的教學用的是 `sonnet`，一份問一次，輸入最多約 150 KB 的原文，比整理用法貴得多；但只有你在用法頁按下「教學」時才會產生，不按就不花用量。
- 「編輯」與點票開檔是呼叫 VS Code 的 `code` 指令，要先確定終端機裡打得出 `code`。

## 使用

- **開啟面板**：session 開始時自動開啟（可以在 [設定] 關掉）。終端機要 144 欄以上，自動開啟的面板才會停靠在右側；隨時可以用 `/cockpit` 開啟。
- **操作面板**：按 `ctrl+x tab` 讓面板取得焦點，之後就能用下面的快速鍵，Tab／方向鍵移動、Enter 按下。用 `/cockpit` 開啟時會直接取得焦點。

| 範圍 | 按鍵 | 動作 |
| --- | --- | --- |
| 全域 | `1` `2` `3` `4` | 切換到 [任務]／[基本]／[SKILL]／[設定] |
| 全域 | `k`／`j` | 上一頁／下一頁 |
| [任務] | `c` | 清除已完成 |
| [任務] | `r` | 重新讀取路線圖 |
| [基本] | `e` | 編輯 `prompts.md` |
| [基本] | `p` | 編輯本專案的 `.claude/prompts.md`（有這個檔案時才出現） |
| [基本] | `r` | 重新載入 |
| [SKILL] | `s` | 跳到搜尋框（按 `Esc` 離開，搜尋文字會保留） |
| [SKILL] | `u`，再按 `q` `r` | 更新用法：快速（只補缺的）／重整（全部重新問一次） |
| [SKILL] 的用法頁 | `f` `b` `t` | 把這個 skill 填進輸入框／返回列表／教學（沒有就產生，有就打開） |
| [設定] | `e` | 編輯 SKILL 覆寫檔 |

快速鍵只在面板有焦點時有效，在輸入框打字不會誤觸。

## 設定檔

### 常用 prompt：`~/.claude/cockpit/prompts.md`

第一次按 [基本] 的 `e: 編輯` 時，會建立一份範例。格式：

```markdown
# 審查
## review diff
請 review 目前未 commit 的變更，只列出真正的問題。

## commit 訊息 !
依照目前的變更寫一則繁體中文 commit 訊息，先給我看，不要 commit。

# 規劃
## wayfinder
/mattpocock-skills:wayfinder .scratch/
```

- `# 分組`、`## 名稱`；名稱底下到下一個標題之間的內文就是 prompt，可以多行。
- 名稱結尾加 ` !` 的，點了會直接送出；其餘會填進輸入框。
- 第一個 `#` 之前就出現的 `##`，放在不分組的最前面。
- 常用的 skill 也可以寫成一筆 slash command（如上例的 wayfinder）。

目前專案若有 `.claude/prompts.md`（格式相同），會以「本專案」接在全域清單後面。

### SKILL 覆寫：`~/.claude/cockpit/skills.json`

```json
{
  "groups": { "mattpocock-skills": "mattpocock" },
  "descriptions": { "mattpocock-skills:wayfinder": "大型工作的地圖" },
  "hidden": ["mattpocock-skills:teach", "builtin-skills"]
}
```

| 欄位 | 用途 |
| --- | --- |
| `groups` | 組名改成較短的名稱：plugin 名稱 → 顯示的組名 |
| `descriptions` | 自訂短說明，優先於自動翻譯：skill 完整名稱 → 說明 |
| `hidden` | 要隱藏的 skill（完整名稱）或整組。組的 id 是 plugin 名稱，另外兩組是 `my-skills`、`builtin-skills` |

### 面板參數

在 [設定] 分頁或 `/config` 都能改，兩邊改的是同一份值，存在 `settings.json` 的 `pluginConfigs`。改了立即生效，[設定] 最下面有 `[ 恢復預設值 ]` 與 `[ 重新載入 mod ]`（面板狀態不對時救急用：跑內建的 `/reload-plugins`，所有 mod 一起重載，cockpit 重載完會跳「cockpit 已重新載入」），再下面一行是目前裝的版本（例如 `cockpit 0.5.3`），後面有「檢查版本」（見下方「更新」）。

| 參數 | 預設 | 選項 |
| --- | --- | --- |
| 強調色 | `claude` | 幾個主題色 |
| 黃色門檻 | 50% | 40–90% |
| 紅色門檻 | 80% | 40–90% |
| toast 門檻 | 80% | 關／70／80／90% |
| 自動開啟 | 開 | 開／關 |
| 預設分頁 | 上次停的 | 上次停的／任務／基本／SKILL |
| inline 行數（面板顯示在輸入框上方時，下方區塊最多幾行） | 8 | 4–12 |
| 翻譯說明 | 開 | 開／關 |
| 整理用法 | 開 | 開／關 |
| 排列方式（[SKILL] 一組裡的 skill 怎麼排） | 橫向 | 橫向／垂直 |
| 自動更新（開場時自己看有沒有發布新版） | 關 | 開／關 |

### 更新

發布的版本以公開的發布 repo `justin-orderathome/cockpit-release` 裡 `plugin.json` 的 `version` 為準。檢查時先請 Claude Code 把 marketplace 拉到最新，再讀它在本機的那一份，所以問你的版本號就是實際會換上的那一版。比的是「和你裝的一不一樣」，不是「比較新」，所以作者退回舊版時也會跟著換。

- **檢查版本**：[設定] 最下面版本號後面的按鈕。按了去看發布的版本：一樣就說已經是發布的版本；不一樣就問「要立即更新嗎？」，選「立即更新」會下載新版並重新載入 mod，換好後跳「cockpit 已更新到 x.y.z」；選「先不要」什麼都不做。
- **自動更新**（[設定]，預設關）：打開後，每次 session 開始時自己檢查一次，有不一樣的版本就在背景下載，跳「cockpit x.y.z 已下載，下次開啟時換上」；不會打斷正在用的這個 session。同一版只下載一次。
- **換了版本會講**：不管是怎麼換的，開場時發現版本和上次不一樣，就跳「cockpit 已更新到 x.y.z」。
- **只對從 marketplace 裝的有效**：檢查是跑 `claude plugin marketplace update`，更新是跑 `claude plugin update`。用資料夾加 `CLAUDE_CODE_PLUGIN_DIRS` 載入的那一份，「檢查版本」改成上網看發布 repo（剛發布的幾分鐘內可能還是舊的），只會告訴你發布的是哪一版，要自己換；自動更新對它沒有作用。
- 連不上會說查不到，不影響其他功能。

### SKILL 說明的翻譯

讀到 skill 清單時，cockpit 會把還沒翻過的英文說明，每 10 筆一批交給 `haiku` 翻成繁體中文（已經是中文的略過）。結果會快取，之後只有新裝的 skill，或說明有改的，才會再翻。翻譯會用到你的 API 用量，不需要的話可以在 [設定] 關掉。

### SKILL 的用法

說明通常只有一兩句，作者規劃的觸發詞、參數、模式與步驟多半寫在 SKILL.md 的內文。讀到 skill 清單時，cockpit 會在說明翻完之後，把每個 skill 的 SKILL.md 交給 `haiku` 整理成四項用法，一個 skill 問一次，同時最多 3 個：

| 項目 | 內容 |
| --- | --- |
| 何時用 | 觸發詞與適用的情境 |
| 怎麼叫 | 參數與模式 |
| 會做什麼 | 作者規劃的步驟或產出 |
| 搭配 | 原文裡點名的其他 skill |

原文沒寫的那一項不顯示；觸發詞、指令與 skill 名稱保留原文。

- **怎麼看**：有用法的 skill 名稱後面有 `?`，點了進用法頁；滑鼠停在名稱上時，說明區的標題也會提示有幾項用法，或「用法整理中…」。用法頁放不下時用翻頁鍵。搜尋框也會比對用法，所以打觸發詞就找得到對應的 skill。
- **原文從哪裡來**：使用者自己的 skill（`~/.claude/skills/`，含 claude.ai 同步的）、plugin 的 skill（依 `installed_plugins.json` 找安裝目錄）與專案的 skill（`.claude/skills/`）讀 SKILL.md；只讀 SKILL.md 本身，不讀它引用的其他檔案。找不到檔案的（例如內建 skill）改用說明來整理，用法頁會標示「只依說明整理」。
- **什麼時候重新整理**：結果會快取。只有新裝的 skill、SKILL.md 的內容改過，或 cockpit 更新了整理的規則時，才會再問模型；plugin 升級但 SKILL.md 沒變不會。
- **失敗時**：單一 skill 失敗就跳過；連續 3 個失敗或模型沒回應（多半是用量用完）就整輪停下，已整理的保留。
- **更新**：一個 session 只會自動整理一輪。之後要再整理（新裝了 skill、上次整理到一半停下）就按搜尋列右邊的「更新用法」，再選一個：**快速**只補還沒有的與原文改過的，已經有的不重做；**重整**不看快取，每個 skill 都重新問一次（覺得整理得不好時用，會花掉幾十次 `haiku` 的用量）。重整到一半停下時，還沒輪到的保留原本的用法。
- **關掉**：[設定] 的「整理用法」。關掉後不再問模型，也不顯示 `?`；已存的用法留著，重新打開就直接用。它與「翻譯說明」互不影響。

### SKILL 的教學

說明和用法都是摘要，夠用來想起來，不夠用來學會。教學是第三層：一份拿來學這個 skill 的繁體中文文件。

| | 什麼時候看 | 長度 | 怎麼來 |
| --- | --- | --- | --- |
| 說明 | 已經熟，掃一眼 | 一兩句 | 自動翻譯 |
| 用法 | 快要用，確認怎麼叫 | 四項條列 | 自動整理 |
| 教學 | 第一次學，或忘了回來讀 | 一份文件 | 你按了才產生 |

- **怎麼產生**：在用法頁按「教學」（`t`）。cockpit 把原文交給 `sonnet` 寫成一份 markdown，存檔後用 VS Code 打開。產生要等一陣子，這段時間按鈕會顯示「教學產生中…」，可以離開用法頁做別的事；同一時間只產一份。已經有教學時，再按就直接打開，不會重產；檔案本來就開著的話編輯器只會切到那個分頁，面板會跳「教學已在編輯器打開」。
- **內容**：固定六章（做什麼、什麼時候用與不該用、怎麼叫、怎麼進行、範例、搭配與後續），原文沒寫的那一章省略。指令、參數與 skill 名稱保留原文。作者沒寫範例時，模型會依原文寫示意的範例，標題都標「（示意）」；其他章節只講原文有的。
- **檔案在哪**：`~/.claude/cockpit/tutorials/<skill 名稱>.md`（名稱裡不能當檔名的字元會換掉，例如 `impeccable:impeccable` 是 `impeccable%3Aimpeccable.md`）。檔案是你的，可以自己加筆記。開頭有幾行資訊，記著它是依哪一版原文產的。
- **讀哪些檔**：SKILL.md，加上它用連結點到、而且在這個 skill 自己資料夾底下的文件（`.md`、`.mdx`、`.txt`），只跟一層。合計上限 150 KB，依出現的順序讀，放不下的與讀不到的會列在教學開頭。找不到 SKILL.md 的 skill（例如內建的）沒有「教學」按鈕。
- **原文更新之後**：不會自動重產。舊的教學照樣可以打開，用法頁會標「教學：原文已更新」。要重來就按「重新產生」，再按一次「覆蓋」確認；重新產生是整份覆蓋，你加的筆記不會保留。
- **失敗時**：跳 toast 說明原因，不會留下半成品；重新產生失敗時原本的檔案不動。
- **沒有開關**：不按就不讀檔、不問模型。不過教學的按鈕在用法頁上，[設定] 的「整理用法」關掉時進不了用法頁，也就按不到。

## 疑難排解

**面板的框線破掉、有殘影**（VS Code 終端機）：右框線有些行不見或偏一格，對話區右緣出現零星的「│」。原因是 VS Code 的 `terminal.integrated.gpuAcceleration` 設成了 `off`，終端機改用 DOM 繪製，中文與符號混排時位置會偏。到 VS Code 設定搜尋 `terminal gpu`，把「Terminal › Integrated: Gpu Acceleration」改回 `auto`（預設值），改完立刻生效，不必重開。

## 開發

```
claude plugin validate .     # 檢查設定檔與 hooks module
claude plugin test .         # 跑 tests/ 底下的測試
npx -p typescript tsc -p .   # 型別檢查
git archive --format=zip --prefix=cockpit/ -o dist/cockpit-0.5.3.zip HEAD .claude-plugin hooks types README.md LICENSE   # 打包成給別人安裝的 zip（先 commit；只含執行需要的檔與授權聲明）
```

`register.tsx` 很長是引擎的規定造成的：`$` 只能傳給同一個檔案裡宣告的函式，atom 也要寫在用它的檔案裡，兩者都不會跟著 import 進別的檔案（違反時 mod 會載入失敗）。所以碰到引擎的程式留在那裡，不碰引擎的判斷（顯示哪些字、多寬、幾行、何時重讀）才拆到別的檔案，也才有直接的測試。

型別檢查用的 `tsconfig.json`，延伸的是 `.claude-plugin/types/` 裡的型別設定。那個資料夾由 Claude Code 在載入 mod 時自動產生（已加進 `.gitignore`），所以要先載入過一次才能做型別檢查。

| 檔案 | 內容 |
| --- | --- |
| `hooks/register.tsx` | 所有碰到引擎的程式，分四段：狀態、動作、四個分頁（各一個函式）、事件掛鉤與外框 |
| `hooks/tab.ts` | 一個分頁交給外框的內容長什麼樣（`TabContent`） |
| `hooks/tasks.ts` | 任務的所有變化（TodoWrite、TaskCreate、TaskUpdate、清除、隱藏、跟隨）、攤平的任務樹、預估與校正、每個任務列要畫的欄 |
| `hooks/usage.ts` | 用量（含「狀態」框的行數與配色）與 toast 判斷 |
| `hooks/prompts.ts` | `prompts.md` 解析 |
| `hooks/skills.ts` | SKILL 分組、搜尋與覆寫檔 |
| `hooks/translate.ts` | SKILL 說明的翻譯流程與快取 |
| `hooks/source.ts` | 找一個 skill 的原文（SKILL.md）：各種來源的定位規則 |
| `hooks/howto.ts` | SKILL 用法的整理流程、快取與失效（程式裡用法叫 howto，`usage` 是用量） |
| `hooks/howtoPage.ts` | 用法頁有哪些列、每一列是什麼字（教學的狀態、說明、標題線、四項用法） |
| `hooks/material.ts` | 教學的原料：SKILL.md 加上它連結到的檔，讀到哪裡為止 |
| `hooks/tutorial.ts` | SKILL 教學從讀原料到存檔的整個流程：狀態（沒得產／還沒有／最新／舊的）、產生、教學檔的開頭資訊 |
| `hooks/ask.ts` | 問模型一次的方式與回覆的形狀；翻譯、用法、教學共用 |
| `hooks/once.ts` | 同一時間只跑一件的背景工作（翻譯、整理用法、產生教學各一個） |
| `hooks/layout.ts` | 版面：外框佔掉的行與欄、分頁、（續）、說明欄、把項目排成欄 |
| `hooks/roadmap.ts` | 路線圖：effort 放在哪個目錄，讀它，判斷每個 effort 的階段、票的狀態與下一步；什麼時候要重讀；每一列顯示什麼 |
| `CONTEXT.md` | 用語表（effort、地圖、決策票、實作票…） |
| `hooks/files.ts` | 面板讀寫檔案唯一的方式：路徑怎麼接（專案的檔案從專案根目錄算）、讀不到算什麼；路線圖、原文、教學、常用 prompt 共用 |
| `hooks/remembered.ts` | 跨 session 記住的面板狀態：`$.store` 有哪些鍵、讀回來怎麼驗、開場停在哪個分頁、版本有沒有換 |
| `hooks/release.ts` | 更新：發布的版本去哪裡看、這一份是從哪裡裝的、看完之後該做什麼、要跑哪些指令 |
| `hooks/events.ts` | 引擎的事件對面板代表什麼：工具成功的定義、寫檔與 shell 指令各算哪一種路線圖事件 |
| `hooks/fill.ts` | 填入輸入框的規則 |
| `hooks/config.ts` | 分頁與面板參數（須與 `plugin.json` 的 `userConfig` 一致，有測試檢查） |
| `types/index.d.ts` | `$.state` 的型別合約 |
| `tests/` | 單元測試與面板測試；`fixtures/commandList.ts` 是實測的 `$.command.list()` 輸出 |
