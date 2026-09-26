export const TEMPLATE_DEFINITION_VERSION = 1;
export const FIELD_TYPES = new Set(['text', 'textarea', 'markdown', 'number', 'date', 'select', 'checkbox', 'url', 'multiselect']);
export const RESERVED_FIELD_TYPES = new Set(['image', 'attachment', 'note-link', 'relation-list']);
export const SYSTEM_KEYS = new Set(['draftId', 'id', 'schemaVersion', 'draftRevision', 'revision', 'title', 'folderPath', 'tags', 'relations', 'links', 'attachments', 'createdAt', 'updatedAt', 'deletedAt', 'backupStatus', 'templateId', 'templateVersion', 'fields']);

const validKey = value => typeof value === 'string' && /^[a-z][a-zA-Z0-9_-]*$/.test(value);

export function validateTemplateDefinition(definition) {
  const errors = [];
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return {valid: false, errors: ['模板必須是物件']};
  if (!validKey(definition.templateId)) errors.push('templateId 必須是穩定識別碼');
  if (!Number.isSafeInteger(definition.templateVersion) || definition.templateVersion < 1) errors.push('templateVersion 必須是正整數');
  if (typeof definition.name !== 'string' || !definition.name.trim()) errors.push('name 不可空白');
  if (!['active', 'archived'].includes(definition.status)) errors.push('status 必須是 active 或 archived');
  if (!Array.isArray(definition.sections) || !definition.sections.length) errors.push('sections 必須是非空陣列');
  if (!Array.isArray(definition.fields)) errors.push('fields 必須是陣列');
  const keys = new Set();
  for (const field of Array.isArray(definition.fields) ? definition.fields : []) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) { errors.push('field 必須是物件'); continue; }
    if (!validKey(field.key) || SYSTEM_KEYS.has(field.key)) errors.push(`欄位 key 無效或屬於系統核心：${field.key}`);
    if (keys.has(field.key)) errors.push(`欄位 key 重複：${field.key}`);
    keys.add(field.key);
    if (typeof field.label !== 'string' || !field.label.trim()) errors.push(`欄位 ${field.key} 缺少 label`);
    if (!FIELD_TYPES.has(field.type) && !RESERVED_FIELD_TYPES.has(field.type)) errors.push(`欄位 ${field.key} 的 type 未知`);
    if (['select', 'multiselect'].includes(field.type)) {
      if (!Array.isArray(field.options) || !field.options.length || field.options.some(option => typeof option !== 'string' || !option)) errors.push(`欄位 ${field.key} 缺少有效 options`);
      else if (new Set(field.options).size !== field.options.length) errors.push(`欄位 ${field.key} 的 options 重複`);
    }
  }
  const sectionIds = new Set(), assigned = new Set();
  for (const section of Array.isArray(definition.sections) ? definition.sections : []) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) { errors.push('section 必須是物件'); continue; }
    if (!validKey(section.sectionId) || sectionIds.has(section.sectionId)) errors.push('sectionId 無效或重複');
    sectionIds.add(section.sectionId);
    if (typeof section.title !== 'string' || !section.title.trim()) errors.push('section title 不可空白');
    if (!Array.isArray(section.fieldKeys)) { errors.push('section fieldKeys 必須是陣列'); continue; }
    for (const key of section.fieldKeys) {
      if (!keys.has(key)) errors.push(`section 引用不存在欄位：${key}`);
      if (assigned.has(key)) errors.push(`欄位被多次放入 section：${key}`);
      assigned.add(key);
    }
  }
  for (const key of keys) if (!assigned.has(key)) errors.push(`欄位未放入 section：${key}`);
  return {valid: errors.length === 0, errors};
}
