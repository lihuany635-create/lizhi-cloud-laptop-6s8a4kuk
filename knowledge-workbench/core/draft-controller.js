import {createDraft, deleteDraft, getDraft, importRemoteRecord, listDrafts, saveDraft} from './draft-store.js';
import {addBlob, addResource, removeResource, listBlobs} from './blob-store.js';
import {enqueueDraft, listOutbox} from './outbox-store.js';
import {getTemplate, loadBuiltinTemplates} from './template-registry.js';
import {adaptDraft, validateFields} from './template-values.js';
import {validateLinks, validateRelations} from './resource-model.js';

export class DraftController {
  constructor({onState = () => {}, debounceMs = 800} = {}) {
    this.onState = onState;
    this.debounceMs = debounceMs;
    this.current = null;
    this.status = 'idle';
    this.error = null;
    this.pending = false;
    this.timer = null;
    this.draining = null;
    this.lifecycleAttached = false;
  }

  emit() { this.onState({draft: this.current, status: this.status, error: this.error}); }
  clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  attachLifecycle() {
    if (this.lifecycleAttached) return;
    this.lifecycleAttached = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void this.flush().catch(() => {}); });
    window.addEventListener('pagehide', () => { void this.flush().catch(() => {}); });
  }

  async create() {
    await this.flush();
    this.current = await createDraft();
    this.pending = false;
    this.status = 'saved';
    this.error = null;
    this.emit();
    return this.current;
  }

  async importRecord(record) {
    await this.flush();
    const result = await importRemoteRecord(record);
    await this.open(result.draft.draftId);
    return result;
  }

  async open(draftId) {
    await this.flush();
    const draft = await getDraft(draftId);
    if (!draft) throw new Error('找不到這份本機草稿');
    this.current = adaptDraft(draft);
    this.pending = false;
    this.status = 'saved';
    this.error = null;
    this.emit();
    return this.current;
  }

  update(patch) {
    if (!this.current) throw new Error('請先建立或開啟草稿');
    this.current = {...this.current, ...patch, dirty: true};
    this.pending = true;
    this.status = 'unsaved';
    this.error = null;
    this.emit();
    this.clearTimer();
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, this.debounceMs);
  }

  async flush() {
    this.clearTimer();
    if (this.draining) return this.draining;
    if (!this.pending || !this.current) return this.current;
    this.draining = (async () => {
      while (this.pending && this.current) {
        const snapshot = structuredClone(this.current);
        this.pending = false;
        this.status = 'saving';
        this.emit();
        try {
          const saved = await saveDraft(snapshot);
          if (this.current?.draftId === saved.draftId) {
            this.current = this.pending
              ? {...this.current, draftRevision: saved.draftRevision, updatedAt: saved.updatedAt, lastLocalSavedAt: saved.lastLocalSavedAt}
              : saved;
            this.status = this.pending ? 'unsaved' : 'saved';
            this.error = null;
            this.emit();
          }
        } catch (error) {
          this.pending = true;
          this.status = 'error';
          this.error = error;
          this.emit();
          throw error;
        }
      }
      return this.current;
    })().finally(() => { this.draining = null; });
    return this.draining;
  }

  async addAttachment(file) {
    await this.flush();
    if (!this.current) throw new Error('請先建立草稿');
    const {draft, attachment} = await addBlob(this.current.draftId, file);
    this.current = adaptDraft(draft);
    this.status = 'saved';
    this.emit();
    return attachment;
  }

  async addResource(file, kind) {
    await this.flush();
    if (!this.current) throw new Error('請先建立草稿');
    const {draft, asset} = await addResource(this.current.draftId, file, kind, this.current.draftRevision);
    this.current = adaptDraft(draft);
    this.status = 'saved';
    this.emit();
    return asset;
  }

  async removeResource(identifier, kind) {
    await this.flush();
    if (!this.current) throw new Error('請先開啟草稿');
    const {draft, removed} = await removeResource(this.current.draftId, identifier, kind, this.current.draftRevision);
    this.current = adaptDraft(draft);
    this.status = 'saved';
    this.emit();
    return removed;
  }

  async prepareSend() {
    await this.flush();
    if (!this.current) throw new Error('請先建立草稿');
    const linkResult = validateLinks(this.current.links || []);
    if (!linkResult.valid) {
      const error = new Error('請先確認外部網址');
      error.linkErrors = linkResult.errors;
      throw error;
    }
    if (!validateRelations(this.current)) throw new Error('筆記關聯無效，請先修正');
    if (this.current.templateId) {
      if (this.current.templateId === 'general-note' && this.current.templateVersion === 1 && !getTemplate('general-note', 1)) await loadBuiltinTemplates();
      const template = getTemplate(this.current.templateId, this.current.templateVersion);
      if (!template) throw new Error('找不到這份草稿使用的模板版本，無法準備送出');
      const validation = validateFields(template, this.current.fields);
      if (!validation.valid) {
        const error = new Error('請先完成或確認模板欄位');
        error.fieldErrors = validation.errors;
        throw error;
      }
      const stored = await getDraft(this.current.draftId);
      if (stored && !stored.templateId) {
        this.update({templateId: this.current.templateId, templateVersion: this.current.templateVersion, fields: this.current.fields});
        await this.flush();
      }
    }
    const {draft, job} = await enqueueDraft(this.current.draftId);
    this.current = draft;
    this.status = 'queued';
    this.emit();
    return job;
  }

  async removeCurrent() {
    this.clearTimer();
    if (this.draining) await this.draining;
    if (!this.current) return;
    await deleteDraft(this.current.draftId);
    this.current = null;
    this.pending = false;
    this.status = 'idle';
    this.error = null;
    this.emit();
  }

  list() { return listDrafts(); }
  attachments() { return this.current ? listBlobs(this.current.draftId) : Promise.resolve([]); }
  outbox() { return listOutbox(); }
}
