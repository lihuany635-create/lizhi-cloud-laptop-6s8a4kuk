# Phase 5 — 本機資料夾與路徑契約

## 範圍

知識工作台的資料夾是本機草稿的分類目錄，儲存在既有 IndexedDB `lizhi-knowledge-workbench`（schema version 1）的 `meta` store，key 為 `folder-catalog-v1`。它不是檔案系統資料夾，也不會寫入 GitHub、Obsidian 或正式知識資料層。正式寫入服務仍未啟用。

## 路徑

- 根目錄為空字串 `''`；其餘路徑使用 `/` 分隔，例如 `工程/RC/施工問題`。
- `normalizeFolderPath` 可把反斜線轉為 `/`、修剪段名前後空白並移除多餘分隔符；使用者新建資料夾前仍必須通過嚴格的 `validateFolderPath`。
- 禁止空段、`.`、`..`、Windows 不允許的字元、段名結尾空白或句點、Windows 保留名稱，以及以 `.md` 結尾的資料夾名。
- 路徑比較不分英文字母大小寫。既有路徑再次建立時沿用原本大小寫和 `folderId`，不增加目錄紀錄。
- 新增深層路徑時自動建立缺少的祖先，每個資料夾有穩定的 `folderId`、`path`、`parentPath`、`name`、建立與更新時間。

## 舊草稿與操作

首次載入正式工作台時，從既有草稿的 `folderPath` 補建目錄。此動作只更新目錄紀錄；不修改草稿內容、`draftRevision`、附件或 outbox。無法通過規則的舊路徑會顯示警告，原草稿保持不變，可在開啟後重新選擇位置。

新增知識時先開啟位置選擇器；使用者確認根目錄或資料夾後才建立草稿。既有草稿可另行變更位置。資料夾瀏覽器顯示階層、breadcrumb，選擇資料夾後列出該目錄及子目錄草稿。此階段不提供資料夾重新命名、移動、刪除或實體 `.md` 檔案操作。

## 驗收

在本機靜態服務上執行 `verify-phase3.cjs`、`verify-phase4.cjs`、`verify-phase5.cjs`。Phase 5 驗證路徑規則、階層、重複名稱、選根目錄、舊資料無損補建、離線、重啟、390px 手機寬度，以及沒有網路寫入。
