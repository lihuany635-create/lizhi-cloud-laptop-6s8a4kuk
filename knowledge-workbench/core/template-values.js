import {FIELD_TYPES} from './template-schema.js';

export function defaultValue(field) {
  if (Object.hasOwn(field, 'defaultValue')) return structuredClone(field.defaultValue);
  if (field.type === 'checkbox') return false;
  if (field.type === 'multiselect') return [];
  if (['number', 'date', 'select'].includes(field.type)) return null;
  return '';
}

export function createDefaultFields(template) {
  return Object.fromEntries(template.fields.map(field => [field.key, defaultValue(field)]));
}

export function normalizeFieldValue(field, value) {
  if (value === undefined) return defaultValue(field);
  if (field.type === 'checkbox') return Boolean(value);
  if (field.type === 'multiselect') return Array.isArray(value) ? value.map(String) : [];
  if (field.type === 'number') {
    if (value === '' || value === null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (field.type === 'date' || field.type === 'select') return value === '' || value === null ? null : String(value);
  if (['text', 'textarea', 'markdown', 'url'].includes(field.type)) return value === null ? '' : String(value);
  return value;
}

export function normalizeFields(template, values = {}) {
  const result = {...values};
  for (const field of template.fields) result[field.key] = normalizeFieldValue(field, values[field.key]);
  return result;
}

export function adaptDraft(draft) {
  const legacy = !draft.templateId;
  const fields = {...(draft.fields && typeof draft.fields === 'object' && !Array.isArray(draft.fields) ? draft.fields : {})};
  if (legacy && !Object.hasOwn(fields, 'body') && typeof draft.content === 'string') fields.body = draft.content;
  return {...draft, templateId: legacy ? 'general-note' : draft.templateId,
    templateVersion: legacy ? 1 : draft.templateVersion, fields};
}

export function validateFields(template, values = {}) {
  const errors = {};
  for (const field of template.fields) {
    if (!FIELD_TYPES.has(field.type)) continue;
    const value = values[field.key];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (field.required && empty) { errors[field.key] = '此欄位為必填'; continue; }
    if (empty) continue;
    if (field.type === 'url') {
      try { new URL(value); } catch { errors[field.key] = '請輸入有效網址'; }
    }
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) errors[field.key] = '請輸入有效數字';
    if (field.type === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) errors[field.key] = '請輸入有效日期';
    if (field.type === 'select' && !field.options.includes(value)) errors[field.key] = '選項已變更，請重新確認';
    if (field.type === 'multiselect' && (!Array.isArray(value) || value.some(item => !field.options.includes(item)))) errors[field.key] = '選項已變更，請重新確認';
  }
  return {valid: Object.keys(errors).length === 0, errors};
}
