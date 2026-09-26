import {getTemplate} from './template-registry.js';
import {validateFields} from './template-values.js';

export function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function validateLinks(links = []) {
  const errors = {};
  for (const link of links) if (!isHttpUrl(link.url)) errors[link.linkId] = '網址必須是有效的 http:// 或 https://';
  return {valid: Object.keys(errors).length === 0, errors};
}

export function validateRelations(draft) {
  const seen = new Set();
  for (const relation of draft.relations || []) {
    if (!relation.targetId || relation.targetId === draft.draftId || seen.has(relation.targetId)) return false;
    seen.add(relation.targetId);
  }
  return true;
}

export function validateQueuePayload(draft) {
  const template = draft.templateId ? getTemplate(draft.templateId, draft.templateVersion) : null;
  const fieldResult = draft.templateId ? (template ? validateFields(template, draft.fields) : {valid: false, errors: {}}) : {valid: true, errors: {}};
  const linkResult = validateLinks(draft.links || []);
  return {valid: fieldResult.valid && linkResult.valid && validateRelations(draft),
    templateMissing: Boolean(draft.templateId && !template), fieldErrors: fieldResult.errors, linkErrors: linkResult.errors,
    relationsValid: validateRelations(draft)};
}

export function snapshotPayload(draft) {
  const copy = value => structuredClone(value || []);
  return {draftId: draft.draftId, title: draft.title || '', folderPath: draft.folderPath || '',
    templateId: draft.templateId || null, templateVersion: draft.templateVersion || null,
    fields: structuredClone(draft.fields || {}), tags: copy(draft.tags), images: copy(draft.images),
    attachments: copy(draft.attachments), links: copy(draft.links), relations: copy(draft.relations)};
}

export function updateQueuedJob(job, draft, timestamp) {
  const validation = validateQueuePayload(draft);
  return {...job, payloadRevision: draft.draftRevision, templateId: draft.templateId || null,
    templateVersion: draft.templateVersion || null, payload: snapshotPayload(draft),
    status: validation.valid ? (job.status === 'needs-review' ? 'needs-review' : 'queued') : 'needs-review', updatedAt: timestamp};
}

export function putRelation(relations = [], sourceId, targetId, replacingId = null) {
  if (!targetId || targetId === sourceId) throw new Error('不能把知識關聯到自己');
  if (relations.some(item => item.targetId === targetId && item.relationId !== replacingId)) throw new Error('這篇知識已經有相同關聯');
  if (replacingId) {
    if (!relations.some(item => item.relationId === replacingId)) throw new Error('找不到要替換的關聯');
    return relations.map(item => item.relationId === replacingId ? {...item, targetId, type: 'related'} : item);
  }
  return [...relations, {relationId: crypto.randomUUID(), targetId, type: 'related'}];
}
