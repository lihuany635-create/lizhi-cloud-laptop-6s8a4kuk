# Phase 7 —「問題／解法」正式模板 v1

穩定識別碼為 `problem-solution`，版本為 `1`。這個 ID 一旦開始保存草稿就不可因顯示名稱改動而更換。模板定義位於 `templates/builtin/problem-solution.v1.json`，由 Phase 6 Registry 註冊，並由通用 Form Renderer 動態呈現；工作台沒有為此模板手寫欄位 HTML。

模板共有五個區段、16 個欄位：問題（發生日期、問題／現象、背景／情境、發生位置、相關問題）、分析（可能原因、已確認原因、分析備註）、處理（解決／處理方式、處理步驟、使用資源／工具）、結果（處理結果、是否已解決、後續追蹤）、補充（主要參考網址、其他備註）。`issue` 和 `solution` 僅在「準備送出」時必填；未完成內容仍可本機自動儲存。`sourceUrl` 為單一網址，非空時送出前須通過 URL 驗證。

`title`、`folderPath`、`tags`、`draftRevision`、附件與關聯等仍是系統核心資料，不放進模板 `fields`。使用者仍先選資料夾，再選模板。草稿固定記住 `templateId`／`templateVersion`；未來新版本不會自動套到 v1 草稿。`general-note` v1 保留供舊草稿使用。IndexedDB 維持 version 1。

Outbox 仍只是本機待送出佇列，並非已同步 GitHub。此階段不新增圖片、附件、外部網址集合或筆記關聯型模板欄位，也不做 Markdown、Bridge 或 Obsidian 寫入。
