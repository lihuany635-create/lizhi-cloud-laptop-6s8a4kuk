import {idbRequest, withTransaction} from './draft-db.js';
import {getAncestorPaths, getFolderLookupKey, getFolderName, normalizeFolderPath, validateFolderPath} from './folder-model.js';

export const FOLDER_CATALOG_KEY = 'folder-catalog-v1';
const freshCatalog = () => ({key: FOLDER_CATALOG_KEY, version: 1, revision: 0, updatedAt: null, folders: []});

function addPath(catalog, path, timestamp) {
  const byKey = new Map(catalog.folders.map(folder => [getFolderLookupKey(folder.path), folder]));
  let current = '';
  let added = 0;
  for (const segment of path.split('/')) {
    const candidate = current ? `${current}/${segment}` : segment;
    const existing = byKey.get(getFolderLookupKey(candidate));
    if (existing) { current = existing.path; continue; }
    const folder = {folderId: crypto.randomUUID(), path: candidate, name: segment, parentPath: current, createdAt: timestamp, updatedAt: timestamp};
    catalog.folders.push(folder);
    byKey.set(getFolderLookupKey(candidate), folder);
    current = candidate;
    added += 1;
  }
  return {path: current, added};
}

export async function getFolderCatalog() {
  return (await withTransaction(['meta'], 'readonly', tx => idbRequest(tx.objectStore('meta').get(FOLDER_CATALOG_KEY)))) || freshCatalog();
}

export async function listFolders() { return (await getFolderCatalog()).folders; }

export async function ensureFolder(input) {
  const path = normalizeFolderPath(input);
  const validation = validateFolderPath(path);
  if (!validation.valid) throw new Error(validation.error);
  return withTransaction(['meta'], 'readwrite', async tx => {
    const store = tx.objectStore('meta');
    const existing = await idbRequest(store.get(FOLDER_CATALOG_KEY));
    const catalog = existing || freshCatalog();
    const timestamp = new Date().toISOString();
    const result = path ? addPath(catalog, path, timestamp) : {path: '', added: 0};
    if (!existing || result.added) {
      catalog.revision += 1;
      catalog.updatedAt = timestamp;
      await idbRequest(store.put(catalog));
    }
    return {catalog, folder: result.path ? catalog.folders.find(folder => folder.path === result.path) : null, path: result.path, added: result.added};
  });
}

export async function ensureFoldersFromDrafts(drafts) {
  const warnings = [];
  const paths = [];
  for (const draft of drafts) {
    const original = draft.folderPath || '';
    if (!original) continue;
    const path = normalizeFolderPath(original);
    const validation = validateFolderPath(path);
    if (!validation.valid) warnings.push({draftId: draft.draftId, folderPath: original, reason: validation.error});
    else paths.push(path);
  }
  const result = await withTransaction(['meta'], 'readwrite', async tx => {
    const store = tx.objectStore('meta');
    const existing = await idbRequest(store.get(FOLDER_CATALOG_KEY));
    const catalog = existing || freshCatalog();
    const timestamp = new Date().toISOString();
    let added = 0;
    for (const path of paths) added += addPath(catalog, path, timestamp).added;
    if (!existing || added) {
      catalog.revision += 1;
      catalog.updatedAt = timestamp;
      await idbRequest(store.put(catalog));
    }
    return {catalog, added};
  });
  return {...result, warnings};
}

export async function folderExists(path) {
  if (path === '') return true;
  const key = getFolderLookupKey(path);
  return (await listFolders()).some(folder => getFolderLookupKey(folder.path) === key);
}

export async function getFolderTree() {
  const catalog = await getFolderCatalog();
  const root = {path: '', name: '根目錄', children: []};
  const nodes = new Map([['', root]]);
  for (const folder of catalog.folders) nodes.set(folder.path, {...folder, children: []});
  for (const folder of catalog.folders) (nodes.get(folder.parentPath) || root).children.push(nodes.get(folder.path));
  const sort = node => { node.children.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')); node.children.forEach(sort); };
  sort(root);
  return root;
}

export function describeFolderPath(path) {
  return path ? `全部知識 > ${getAncestorPaths(path).map(getFolderName).join(' > ')}` : '全部知識 > 根目錄';
}
