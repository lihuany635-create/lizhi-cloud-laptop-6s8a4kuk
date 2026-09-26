import {validateTemplateDefinition} from './template-schema.js';

const templates = new Map();
let builtinLoading;
const keyOf = (id, version) => `${id}\u0000${version}`;

export function registerTemplate(definition) {
  const result = validateTemplateDefinition(definition);
  if (!result.valid) throw new Error(`模板定義無效：${result.errors.join('；')}`);
  const key = keyOf(definition.templateId, definition.templateVersion);
  if (templates.has(key)) throw new Error(`模板版本已註冊：${definition.templateId} v${definition.templateVersion}`);
  const copy = structuredClone(definition);
  templates.set(key, copy);
  return structuredClone(copy);
}

export function getTemplate(id, version) {
  const value = templates.get(keyOf(id, version));
  return value ? structuredClone(value) : null;
}

export function getLatestTemplate(id) {
  return listTemplates().filter(item => item.templateId === id).sort((a, b) => b.templateVersion - a.templateVersion)[0] || null;
}

export function listTemplates({status} = {}) {
  return [...templates.values()].filter(item => !status || item.status === status)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || b.templateVersion - a.templateVersion)
    .map(item => structuredClone(item));
}

export async function loadBuiltinTemplates() {
  if (getTemplate('general-note', 1)) return;
  if (!builtinLoading) builtinLoading = (async () => {
    const response = await fetch(new URL('../templates/builtin/general-note.v1.json', import.meta.url));
    if (!response.ok) throw new Error(`無法載入內建模板：HTTP ${response.status}`);
    registerTemplate(await response.json());
  })().catch(error => { builtinLoading = null; throw error; });
  await builtinLoading;
}
