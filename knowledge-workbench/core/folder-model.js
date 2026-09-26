const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const ILLEGAL = /[<>:"\\|?*\u0000-\u001f]/;

export function normalizeFolderPath(input) {
  return String(input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('/');
}

export function validateFolderPath(path) {
  if (typeof path !== 'string') return {valid: false, error: '資料夾路徑必須是文字'};
  if (path === '') return {valid: true, path: ''};
  if (path !== normalizeFolderPath(path)) return {valid: false, error: '路徑請使用 / 分層，且名稱前後不可有空白或多餘分隔符'};
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..') return {valid: false, error: '資料夾名稱不能是空白、. 或 ..'};
    if (ILLEGAL.test(segment)) return {valid: false, error: '資料夾名稱包含 Windows 不允許的字元'};
    if (/[. ]$/.test(segment)) return {valid: false, error: '資料夾名稱不能以句點或空白結尾'};
    if (RESERVED.test(segment)) return {valid: false, error: '資料夾名稱是 Windows 保留名稱'};
    if (/\.md$/i.test(segment)) return {valid: false, error: '資料夾位置不能使用 .md 副檔名'};
  }
  return {valid: true, path};
}

export function splitFolderPath(path) { return path ? path.split('/') : []; }
export function getParentFolderPath(path) { return splitFolderPath(path).slice(0, -1).join('/'); }
export function getFolderName(path) { return splitFolderPath(path).at(-1) || '根目錄'; }
export function getAncestorPaths(path) {
  const parts = splitFolderPath(path);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}
export function getFolderLookupKey(path) { return normalizeFolderPath(path).toLowerCase(); }
