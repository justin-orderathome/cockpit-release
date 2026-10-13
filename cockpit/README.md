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

需要 Windows、Claude Code 2.1.294 以上（用 `claude --version` 確認）與 `git`。cockpit 從公開的發布 repo `justin-orderathome/cockpit-release` 安裝，第一次安裝與從舊的資料夾搬過來都用同一種做法。

### 貼一段文字給 Claude Code

開 Claude Code，把下面整段貼進去送出。它會先確認這台機器裝得起來，再備份並修改設定檔、把原本的設定與快取帶過來、刪掉舊的 cockpit 資料夾，最後列出改了什麼。照它最後說的，把所有 Claude Code 關掉再開，就會自己裝起來。

```text
請幫我在這台 Windows 電腦上安裝 cockpit（Claude Code 的右側面板）。原本是用資料夾載入的話，一併搬到新的安裝方式。照下面七步依序做，每一步的「確認」成立才做下一步。

每一步只有三種結果：
- 完成：「確認」成立，做下一步。
- 略過：這一步要處理的東西本來就不存在（例如沒有舊資料夾）。記下略過與原因，做下一步。
- 停下來：指令失敗、檔案讀不懂，或「確認」不成立。後面的步驟都不做，告訴我停在第幾步、看到的完整訊息、到目前為止改了哪些檔，以及最後「退路」那一段。

「設定檔」指 %USERPROFILE%\.claude\settings.json。只改下面寫到的鍵，其餘內容與排版原樣保留：用編輯檔案的工具改那幾行，不用 PowerShell 把整份 JSON 讀進來再寫回去（會弄亂排版與中文）。

第 1 步　確認這台機器裝得起來（只查，不改任何東西）
  執行 git --version
    找不到 git：停下來。請我先裝 Git for Windows（在 PowerShell 執行 winget install Git.Git），裝好後把 Claude Code 全部關掉再開，把這段文字重貼一次。
  執行 git ls-remote https://github.com/justin-orderathome/cockpit-release.git
    失敗：停下來。把完整的錯誤訊息給我，請我轉給 Justin。
  確認：兩個指令都成功，第二個至少印出一行 commit。

第 2 步　備份設定檔
  把設定檔複製成同一個資料夾裡的 settings.backup-cockpit-<年月日-時分秒>.json。
  設定檔不存在：略過（第 3 步會建立一份新的）。
  確認：備份檔存在，大小與設定檔相同。記下備份檔的完整路徑。

第 3 步　改設定檔的三處
  (a) env 裡的 CLAUDE_CODE_PLUGIN_DIRS
      它的值是用 ; 隔開的一個或多個資料夾。逐一讀 <資料夾>\.claude-plugin\plugin.json，name 是 cockpit 的那一個就是「舊資料夾」：記下它的完整路徑，把它從值裡拿掉，其餘的資料夾照原樣留著。值裡只有它一個時，把 CLAUDE_CODE_PLUGIN_DIRS 這一行整個拿掉。
      沒有這個鍵，或沒有任何一個資料夾符合：略過，並記下「沒有舊資料夾」。路徑裡有 cockpit 字樣卻不符合的，原樣留著，最後告訴我。
  (b) extraKnownMarketplaces 裡的 orderathome，內容是：
          "orderathome": {
            "source": { "source": "github", "repo": "justin-orderathome/cockpit-release" }
          }
      extraKnownMarketplaces 已經存在時，把這一筆加進現有的那一段。orderathome 這一筆已經存在時，把它改成和上面一樣；裡面有 "autoUpdate" 就把那一行拿掉。
  (c) enabledPlugins 裡加上 "cockpit@orderathome": true
      enabledPlugins 已經存在時，把這一筆加進現有的那一段。
  確認：設定檔解析得過（是合法的 JSON）；extraKnownMarketplaces 與 enabledPlugins 在最外層各只出現一次；重讀檔案，(a)(b)(c) 的值都和上面寫的一樣；和備份比，只有這三處不同。
  解析不過：把備份複製回設定檔，然後停下來。

第 4 步　把原本在 [設定] 改過的值帶過來
  把設定檔裡 pluginConfigs["cockpit@inline"] 的內容原樣複製一份，放在 pluginConfigs["cockpit@orderathome"]。原本那一筆留著。
  沒有 pluginConfigs["cockpit@inline"]，或 pluginConfigs["cockpit@orderathome"] 已經存在：略過，已經存在的那一筆不動。
  確認：設定檔解析得過，兩筆的內容相同。

第 5 步　把翻譯與用法的快取帶過來
  來源：%USERPROFILE%\.claude\plugins\store\cockpit_inline-e1f824f0cbe5.json
  目的：%USERPROFILE%\.claude\plugins\store\cockpit_orderathome-7aade36bdd60.json
  把來源複製成目的。來源留著。
  來源不存在，或目的已經存在：略過，已經存在的目的檔不動。
  確認：目的檔存在，大小與來源相同。

第 6 步　刪掉舊資料夾
  第 3 步記下「沒有舊資料夾」：略過。
  舊資料夾裡有 .git（它是 git 的工作目錄，裡面可能有還沒推上去的東西）：不刪，留著，最後告訴我它的路徑與「是 git 的工作目錄所以沒刪」。
  刪之前重讀一次 <舊資料夾>\.claude-plugin\plugin.json：檔案存在而且 name 是 cockpit 才把整個舊資料夾刪掉。不是的話留著，最後告訴我它的路徑與沒刪的原因。
  刪不掉（檔案被占用）：留著，最後請我把 Claude Code 全部關掉之後自己刪，然後照常做第 7 步。
  確認：舊資料夾已經不存在，或已記下留著的原因。

第 7 步　告訴我改了什麼
  先查系統層級的環境變數（只查不改），在 PowerShell 執行：
    [Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS','User')
    [Environment]::GetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS','Machine')
  有值的話在清單裡寫出來，並提醒我：裡面如果有舊的 cockpit 資料夾要自己拿掉，不拿掉的話跑的仍是舊的那一份，而且不會有任何提示。
  然後列一份清單，七步每一步各一行，寫完成、略過（原因）或沒做（原因），並包含：
    - 備份檔的完整路徑
    - 設定檔裡每一個改過的鍵，改之前與改之後的值
    - 快取檔有沒有複製
    - 舊資料夾的路徑，刪了還是留著
  最後請我做這件事：把所有 Claude Code 視窗關掉再開。第一次開啟會自己下載安裝，大約一分鐘內右側出現面板；切到 [設定] 捲到最下面，看得到 cockpit 與版本號就是裝好了。面板沒有自己出現時打 /cockpit。

退路（任何一步停下來，或重開之後面板不正常時告訴我）
  把第 2 步的備份檔複製回 %USERPROFILE%\.claude\settings.json（第 2 步略過的話，把第 3 步新建的設定檔刪掉），再向 Justin 要一份 cockpit 的 zip。
```

### 手動的步驟（備案）

不想讓 Claude Code 替你改設定檔時照這裡做。先確認裝得起來：在 PowerShell 執行 `git --version` 與 `git ls-remote https://github.com/justin-orderathome/cockpit-release.git`，兩個都要成功；沒有 `git` 就先執行 `winget install Git.Git`。

1. 關掉所有 Claude Code，備份設定檔：

   ```powershell
   Copy-Item $HOME\.claude\settings.json $HOME\.claude\settings.backup-cockpit.json
   ```

2. 用記事本開 `%USERPROFILE%\.claude\settings.json`，改三處：

   - **拿掉舊的資料夾**：`"env"` 裡有 `"CLAUDE_CODE_PLUGIN_DIRS"` 的話，把 cockpit 的那一個資料夾從值裡拿掉（多個資料夾用 `;` 隔開）；只有它一個就整行刪掉。不拿掉的話跑的還是舊的那一份，而且沒有任何提示。
   - **加上 marketplace**：在最外層的 `{ }` 裡加上 `extraKnownMarketplaces` 的 `orderathome`。
   - **啟用**：在 `enabledPlugins` 加上 `"cockpit@orderathome": true`。

   ```json
   "extraKnownMarketplaces": {
     "orderathome": {
       "source": { "source": "github", "repo": "justin-orderathome/cockpit-release" }
     }
   },
   "enabledPlugins": {
     "cockpit@orderathome": true
   }
   ```

   原本就有 `extraKnownMarketplaces` 或 `enabledPlugins` 時，把裡面那一筆加進現有的段落，不要重複開一段。

3. 原本用資料夾載入、想把設定與快取帶過來的話（不做也能用，只是 [設定] 回到預設值，翻譯與用法會重新整理一輪）：

   - 設定：把設定檔裡 `pluginConfigs` 的 `"cockpit@inline"` 那一筆複製一份，鍵改成 `"cockpit@orderathome"`。
   - 快取：`cockpit_orderathome-7aade36bdd60.json` 還不存在時才複製。

     ```powershell
     Copy-Item $HOME\.claude\plugins\store\cockpit_inline-e1f824f0cbe5.json $HOME\.claude\plugins\store\cockpit_orderathome-7aade36bdd60.json
     ```

4. 存檔，開 Claude Code。第一次開啟會自己下載安裝，大約一分鐘內右側出現面板；[設定] 最下面看得到 `cockpit` 與版本號就是裝好了。面板沒有自己出現的話打 `/cockpit`。
5. 確認面板正常之後，把舊的 cockpit 資料夾刪掉。它如果是用 git clone 下來的（裡面有 `.git`），先確認沒有還沒推上去的東西，或乾脆留著。

**出事時的退路**：把設定檔的備份複製回 `%USERPROFILE%\.claude\settings.json`，再向作者要一份 zip。

**之後的更新**不必重裝，見下面的「更新」一節。你的設定、常用 prompt 與 SKILL 覆寫都存在別的地方（`settings.json` 與 `~/.claude/cockpit/`），換版不會被蓋掉。

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

在 [設定] 分頁或 `/config` 都能改，兩邊改的是同一份值，存在 `settings.json` 的 `pluginConfigs`。改了立即生效，[設定] 最下面有 `[ 恢復預設值 ]` 與 `[ 重新載入 mod ]`（面板狀態不對時救急用：跑內建的 `/reload-plugins`，所有 mod 一起重載，cockpit 重載完會跳「cockpit 已重新載入」），再下面一行是目前裝的版本（`cockpit x.y.z`），後面有「檢查版本」與「更新紀錄」；發布的版本和裝的不同時，版本號後面會留著高亮的「有新版 x.y.z」，已經下載的話是「x.y.z 已下載，重開後換上」、按鈕換成「立即換上」（見下方「更新」）。

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
| 自動更新（開場查到不同的版本時自己下載，下次開啟換上；作者退版是例外，關著也會自己下載） | 關 | 開／關 |

### 更新

發布的版本以公開的發布 repo `justin-orderathome/cockpit-release` 裡 `plugin.json` 的 `version` 為準。檢查時先請 Claude Code 把 marketplace 拉到最新，再讀它在本機的那一份，所以問你的版本號就是實際會換上的那一版。比的是「和你裝的一不一樣」，不是「比較新」，所以作者退回舊版時也會跟著換。

- **開場檢查**：從 marketplace 裝的 cockpit 每次開場都在背景看一次發布的版本，「自動更新」開不開都看，不必記得去按「檢查版本」。它排在開場的最後、面板開出來之後才開始，不會讓面板比較慢出現。距離上次檢查不到四小時就跳過（一天開很多個 session 時不會每次都去看）；手動按「檢查版本」不受這個限制。查不到（沒有網路、指令失敗、逾時）就安靜略過，下次開場再試。
- **有新版時**：發布的版本和裝的不同、而「自動更新」關著時，不會下載，只跳一次「cockpit 有新版 x.y.z，到 [設定] 按「檢查版本」換上」。同一個發布的版本只提示一次；作者再發下一版時，那一版再提示一次。這裡說的是發布的版本比裝的新；比裝的舊（作者退版）見下面的「退版」。
- **留著的標示**：錯過提示也看得到。發布的版本和裝的不同時，兩處同時留著標示：[設定] 最下面版本號後面高亮的「有新版 x.y.z」，以及分頁列的「設定」變色並帶一個「●」（停在別的分頁也看得出來）。標示不能手動點掉，在詢問選「先不要」也還在；換上之後（裝的和發布的一樣了）才消失。上次查到的發布版本記在 cockpit 的狀態檔，所以四小時內重開、沒有重新檢查時標示也還在。「自動更新」已經把發布的版本下載好時，版本號後面的字換成「x.y.z 已下載，重開後換上」，那一列的按鈕從「檢查版本」換成「立即換上」。
- **檢查版本**：[設定] 最下面版本號後面的按鈕。按了去看發布的版本：一樣就說已經是發布的版本；不一樣就問「要立即更新嗎？」，選「立即更新」會下載新版並重新載入 mod，換好後跳「cockpit 已更新到 x.y.z」；選「先不要」不會下載，標示留著。升版時問句下面會列出你裝的版本之後、到發布的版本為止每一版的更新紀錄（新的在前，最多六條，超過時最後一行是「其餘見更新紀錄」）；發布的那一版沒有更新紀錄就只問不列。發布的版本比裝的舊（作者退版）時，問的是「發布的版本已退回 x.y.z，要立即換上嗎？」，選項是「立即換上」，不列更新紀錄。
- **更新紀錄**：版本號那一列的另一顆按鈕，用 VS Code 打開你裝著的那一版附的 `CHANGELOG.md`，隨時查得到每一版改了什麼；那一版沒有附就跳「這一版沒有更新紀錄」。
- **自動更新**（[設定]，預設關）：打開後，開場檢查查到不一樣的版本就在背景下載，跳「cockpit x.y.z 已下載，下次開啟時換上」，標示換成「已下載」；不會打斷正在用的這個 session。同一版只下載一次，同一個發布的版本也只提示一次，不管是哪一句：已經跳過「有新版 x.y.z」或在「檢查版本」被問過的那一版，之後下載好了只換標示，不再跳「已下載」。背景的下載失敗時不講失敗的原因，改跳那一句「cockpit 有新版 x.y.z，到 [設定] 按「檢查版本」換上」（一樣每版一次），標示維持「有新版 x.y.z」；這次不算檢查過，下次開場不必等四小時就會再試。
- **退版**：作者收回出事的版本時，發布的版本會比你裝的舊。這時開場檢查不管「自動更新」開不開都在背景下載，跳一次「cockpit 發布的版本已退回 x.y.z，已下載，下次開啟時換上」，下次開啟 Claude Code 就退回那一版；想當下就換，按「立即換上」。這是「自動更新」關著時唯一不問你就下載的情況：出事的版本不該留在你的機器上等你有空才換。標示寫的是「已退回 x.y.z，重開後換上」，按鈕是「立即換上」；背景的下載失敗時不講失敗的原因，改跳一次「cockpit 發布的版本已退回 x.y.z，到 [設定] 按「檢查版本」換上」，標示是「發布的版本已退回 x.y.z」，按鈕是「檢查版本」（按了會問要不要立即換上）；這次不算檢查過，下次開場不必等四小時就會再試。換上之後跳「cockpit 已退回 x.y.z」，標示消失。版本號不是純數字、比不出新舊時照升版處理，不會自己下載。
- **立即換上**：新版已經下載、還沒換上時，[設定] 版本號那一列的按鈕。按了不會再問，直接重新載入 mod，當下就換成新版，不必重開 Claude Code；換好後跳「cockpit 已更新到 x.y.z」（退版是「cockpit 已退回 x.y.z」），標示消失。不按也沒關係，下次開啟 Claude Code 時一樣會換上。已下載之後作者又發了別的版本時，已下載的那一版不算數：標示照新的發布版本重新判斷（回到「有新版」，等下載好再變成「已下載」）。
- **下載之後作者又收回**：已經下載了 x.y.z 還沒換上，發布的版本又變回你現在裝的這一版時（作者把 x.y.z 收回了），cockpit 會把磁碟上的那一份換回發布的版本，免得下次開啟換成被收回的 x.y.z。開場檢查與手動按「檢查版本」都會做，不會跳訊息；沒換成就安靜略過，下次開場（不必等四小時）或下次按「檢查版本」再試。
- **換了版本會講**：不管是怎麼換的，開場時發現版本和上次不一樣，就跳「cockpit 已更新到 x.y.z」；版本號變小（作者退版）時跳「cockpit 已退回 x.y.z」。
- **只對從 marketplace 裝的有效**：檢查是跑 `claude plugin marketplace update`，更新是跑 `claude plugin update`。用資料夾加 `CLAUDE_CODE_PLUGIN_DIRS` 載入的那一份，「檢查版本」改成上網看發布 repo（剛發布的幾分鐘內可能還是舊的），只會告訴你發布的是哪一版，要自己換；它開場不檢查、沒有標示，自動更新對它也沒有作用。
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
node --test scripts/publish.test.mjs   # 跑發布指令的測試（和上面的測試分開跑）
```

### 發布

```
node scripts/publish.mjs --dry-run   # 預演：檢查照跑，印出會發布哪個 commit、哪個版本號、哪些檔；不推、不打 tag
node scripts/publish.mjs             # 發布目前的 HEAD
node scripts/publish.mjs v0.6.0      # 退版：重發先前發布過的那一版（帶它的 tag 名稱）
```

發布之前先做三件事：在 `.claude-plugin/plugin.json` 改版本號（只有這一處要改）、在 `CHANGELOG.md` 加一個標題剛好是版本號的段落（`## x.y.z`）、commit 並推到 `main`。指令不替你改版本號，也不替你 commit。

指令會依序做：

1. **檢查**，全部通過才往下：版本號的 tag 沒有打在別的 commit 上、工作目錄是乾淨的、HEAD 已經推到遠端的 `main`、更新紀錄有這一版的條目，再跑上面的驗證、測試與型別檢查。
2. 把發布 repo 重新 clone 到暫存資料夾，整個換掉裡面的 `cockpit/`（`.claude-plugin`、`hooks`、`types`、`README.md`、`LICENSE`、`CHANGELOG.md`，內容取自 commit，不是工作目錄），並把根目錄的 `LICENSE` 換成同一份。marketplace 的目錄檔與根目錄的 README 不碰。
3. 發布的版本和這次的版本號一樣、內容卻不同時停下來，請你先改版本號：同事機器上的快取是照版本號認的，版本號沒變就拿不到新內容。
4. commit（訊息是「cockpit x.y.z（原始碼 abc1234）」）並推到發布 repo，再在被發布的 commit 打 `vx.y.z` 並推到原始碼 repo。這個 tag 就是之後退版的目標。

任何一步失敗都會印出失敗在哪一步，結束碼不是零。發布 repo 推上去之後才失敗（例如 tag 沒推成功）的，直接重跑：內容已經一樣時不會多一個 commit，只補上 tag。

**退版**：發出去的版本出事時，帶上先前那一版的 tag 名稱再跑一次（`git tag -l` 看有哪些），發布的版本就換回那一版，內容與版本號都取自那個 tag 指向的 commit。這是出事時用的，所以不要求工作目錄乾淨、不要求已推送，也不跑驗證、測試、型別檢查與更新紀錄的檢查，手上改到一半也能立刻退。發布 repo 照樣往前多一個 commit（歷史不改寫），tag 已經在就不再打；同事那邊不管「自動更新」開不開都會跟著退回。可以先加 `--dry-run` 預演。只收版本的 tag（`vx.y.z`），分支與 commit 的 hash 不收；指定的 tag 不存在會停下來。

**用過的版本號不再用**：退版之後修好要再發，一定要換一個新的版本號，就算出事的那一版只發出去幾分鐘。裝過那一版的機器快取是照版本號認的，同一個版本號換了內容，它們會沿用出事的那一份。指令會擋下來：版本的 tag 已經打在別的 commit 上時拒絕發布。

`--release-repo <位置>` 與 `--skip-checks`（跳過驗證、測試與型別檢查）只給測試用。測試會建兩個暫存的 git repo（原始碼 repo 與本機的 bare 發布 repo）讓指令真的跑完，不會碰到真的發布 repo。

`register.tsx` 很長是引擎的規定造成的：`$` 只能傳給同一個檔案裡宣告的函式，atom 也要寫在用它的檔案裡，兩者都不會跟著 import 進別的檔案（違反時 mod 會載入失敗）。所以碰到引擎的程式留在那裡，不碰引擎的判斷（顯示哪些字、多寬、幾行、何時重讀）才拆到別的檔案，也才有直接的測試。

型別檢查用的 `tsconfig.json`，延伸的是 `.claude-plugin/types/` 裡的型別設定。那個資料夾由 Claude Code 在載入 mod 時自動產生（已加進 `.gitignore`），所以要先載入過一次才能做型別檢查。

面板測試裡的 cockpit 是從資料夾載入的，測試工具也沒有辦法指定 plugin 的資料夾。要測「從 marketplace 安裝」才有的行為（開場檢查、標示、「檢查版本」的詢問），就在測試的環境變數裡設 `COCKPIT_TEST_PLUGIN_ROOT`，值是假裝的安裝資料夾（`…/plugins/cache/<marketplace>/<plugin>/<版本>`）；`tests/pane.test.tsx` 的 `marketplaceInstall` 就是這樣做的。它只拿來判斷這一份是從哪裡裝的，讀檔仍然讀真的資料夾；沒設（正式環境）時看的是真的資料夾。

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
| `CHANGELOG.md` | 更新紀錄：寫給同事看的每一版改了什麼。新的在最上面，每版一個二級標題且標題剛好是版本號（cockpit 靠它找條目），底下一到三條，不寫日期 |
| `CONTEXT.md` | 用語表（effort、地圖、決策票、實作票…） |
| `hooks/files.ts` | 面板讀寫檔案唯一的方式：路徑怎麼接（專案的檔案從專案根目錄算）、讀不到算什麼；路線圖、原文、教學、常用 prompt 共用 |
| `hooks/remembered.ts` | 跨 session 記住的面板狀態：`$.store` 有哪些鍵、讀回來怎麼驗（清單、翻譯、版本號）、開場停在哪個分頁、版本有沒有換 |
| `hooks/release.ts` | 更新：發布的版本去哪裡看、這一份是從哪裡裝的、看完之後該做什麼、要跑哪些指令；版本號誰新誰舊、升版與退版各怎麼講（提示與標示各一組）；開場該不該檢查、該不該自己下載（退版不看「自動更新」）、該不該提示、該不該把磁碟換回發布的版本、該留著哪一種標示 |
| `hooks/changelog.ts` | 更新紀錄：放在哪裡、格式、從裡面挑出哪幾版的條目、怎麼接進「檢查版本」的詢問、沒有這個檔時說什麼。「標題剛好是版本號」這條規則和 `scripts/publish.mjs` 各有一份，要一起改 |
| `hooks/events.ts` | 引擎的事件對面板代表什麼：工具成功的定義、寫檔與 shell 指令各算哪一種路線圖事件 |
| `hooks/fill.ts` | 填入輸入框的規則 |
| `hooks/config.ts` | 分頁與面板參數（須與 `plugin.json` 的 `userConfig` 一致，有測試檢查） |
| `types/index.d.ts` | `$.state` 的型別合約 |
| `tests/` | 單元測試與面板測試；`fixtures/commandList.ts` 是實測的 `$.command.list()` 輸出 |
| `scripts/publish.mjs` | 發布指令（見上方「發布」）；`publish.test.mjs` 是它的測試，用 Node 內建的測試工具跑；`remove-dir.mjs` 是兩者共用的刪資料夾 |
