# Phase 8 — 本機資源與人工關聯契約

圖片、附件、外部網址與筆記關聯屬於知識記錄的系統層，不放入模板 `fields`。所有模板可共用。IndexedDB 沿用 `lizhi-knowledge-workbench` version 1 的 `drafts`、`blobs`、`outbox`、`meta` stores；沒有新增遠端寫入能力。

## 圖片與附件

草稿的 `images[]`／`attachments[]` 只存 metadata，包括穩定 `assetId`、`blobId`、`kind`、`originalName`、`mimeType`、`size`、`createdAt`。圖片另有 `alt`、`caption`。Blob 本體存在既有 `blobs` store，依 `blobId` 取得。舊附件只含 `blobId`／`name` 的格式仍可顯示、開啟及移除。檔名僅用於畫面和瀏覽器下載名稱，不能作為可信檔案系統路徑。

圖片預覽及附件開啟／下載使用暫時 Object URL，重繪與離開頁面時釋放。刪除資源在單一 IndexedDB transaction 中移除該草稿的 metadata、對應 Blob，並更新 draft revision 與 Outbox snapshot；不會刪除其他草稿的 Blob。新資源的增刪有 `draftRevision` 衝突檢查。

## 外部網址

`links[]` 每筆有穩定 `linkId`、`label`、`url`。編輯網址不更換 ID；草稿允許暫存未完成／不合法網址，但「準備送出」只接受可解析的 `http://`、`https://`。不安全協定不顯示為可點連結。可點連結在新分頁開啟，使用 `rel="noopener noreferrer"`。Phase 7 模板內原有 `sourceUrl` 不變；系統層 links 是獨立的多筆集合。

## 人工筆記關聯

`relations[]` 每筆保存 `relationId`、目標的永久 `draftId` 作為 `targetId`，以及固定 `type: "related"`。目標由使用者透過資料夾瀏覽器手動選取；目前候選只來自本機草稿，沒有 AI 推薦或跨裝置同步。禁止自我關聯與重複 targetId。重新選擇保留 relationId；移除只刪來源記錄的關聯 metadata。目標不存在時保留 targetId，畫面顯示「目標目前不可用」，不依 title 或 folderPath 修補 ID。

## Outbox

Outbox 仍是本機佇列，既有 `operation: "upsert"` 與 dedup 規則不變。新增 `payload` 快照，包含 title、folderPath、templateId／version、fields、tags、images、attachments、links、relations，但不含 Blob 本體。資源變更同步更新 `payloadRevision` 與快照；若網址或模板欄位無效，job 轉為 `needs-review`，須修正後重新按「準備送出」。本階段不宣稱已同步 GitHub、生成 Markdown 或寫入 Obsidian。
