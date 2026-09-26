import {FIELD_TYPES} from '../core/template-schema.js';
import {normalizeFieldValue} from '../core/template-values.js';

function fieldControl(field, value) {
  let control;
  if (['textarea', 'markdown'].includes(field.type)) {
    control = document.createElement('textarea');
    control.rows = field.type === 'markdown' ? 9 : 4;
    control.value = value ?? '';
  } else if (field.type === 'select' || field.type === 'multiselect') {
    control = document.createElement('select');
    control.multiple = field.type === 'multiselect';
    if (control.multiple) control.size = Math.min(5, Math.max(2, field.options.length));
    else {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '請選擇';
      control.append(empty);
    }
    const selected = control.multiple ? (Array.isArray(value) ? value : []) : [value];
    for (const optionValue of [...field.options, ...selected.filter(item => item != null && item !== '' && !field.options.includes(item))]) {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = field.options.includes(optionValue) ? optionValue : `${optionValue}（舊選項，請確認）`;
      option.selected = selected.includes(optionValue);
      control.append(option);
    }
  } else {
    control = document.createElement('input');
    control.type = field.type === 'checkbox' ? 'checkbox' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text';
    if (field.type === 'checkbox') control.checked = Boolean(value);
    else control.value = value ?? '';
  }
  control.dataset.templateField = field.key;
  if (field.key === 'body') control.dataset.kw = 'body';
  return control;
}

export function renderTemplateForm(host, template, values = {}) {
  host.replaceChildren();
  const byKey = new Map(template.fields.map(field => [field.key, field]));
  for (const section of template.sections) {
    const wrapper = document.createElement('section');
    wrapper.className = 'kw-template-section';
    const title = document.createElement('h3');
    title.textContent = section.title;
    wrapper.append(title);
    for (const key of section.fieldKeys) {
      const field = byKey.get(key);
      const label = document.createElement('label');
      label.className = 'kw-template-field';
      const caption = document.createElement('span');
      caption.textContent = `${field.label}${field.required ? ' *' : ''}`;
      label.append(caption);
      if (FIELD_TYPES.has(field.type)) label.append(fieldControl(field, values[key]));
      else {
        const note = document.createElement('small');
        note.className = 'kw-template-unsupported';
        note.textContent = '此欄位類型尚未啟用；原值會保留。';
        label.append(note);
      }
      const error = document.createElement('small');
      error.className = 'kw-field-error';
      error.dataset.fieldError = key;
      error.setAttribute('role', 'alert');
      label.append(error);
      wrapper.append(label);
    }
    host.append(wrapper);
  }
}

export function readTemplateFields(host, template, prior = {}) {
  const values = {...prior};
  for (const field of template.fields) {
    if (!FIELD_TYPES.has(field.type)) continue;
    const control = [...host.querySelectorAll('[data-template-field]')].find(item => item.dataset.templateField === field.key);
    if (!control) continue;
    const raw = field.type === 'checkbox' ? control.checked
      : field.type === 'multiselect' ? [...control.selectedOptions].map(option => option.value)
      : control.value;
    values[field.key] = normalizeFieldValue(field, raw);
  }
  return values;
}

export function showFieldErrors(host, errors = {}) {
  for (const node of host.querySelectorAll('[data-field-error]')) node.textContent = errors[node.dataset.fieldError] || '';
}

export function renderUnknownTemplate(host, draft) {
  host.replaceChildren();
  const message = document.createElement('p');
  message.className = 'kw-template-warning';
  message.textContent = `找不到模板 ${draft.templateId} v${draft.templateVersion}。欄位已保留，但此版本不能編輯或準備送出。`;
  const raw = document.createElement('pre');
  raw.className = 'kw-template-raw';
  raw.textContent = JSON.stringify(draft.fields || {}, null, 2);
  host.append(message, raw);
}
