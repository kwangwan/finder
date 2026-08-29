/**
 * Shared payload format for dragging files and folders onto a folder.
 *
 * Items can be dropped on several different targets — a sub-folder card in
 * the grid, the "상위 폴더" button, a breadcrumb segment, and any folder in
 * the sidebar tree. They all have to agree on the same dataTransfer shape,
 * and each would otherwise need its own copy of the same parse-and-validate
 * block, so it lives here once instead.
 */
const MIME = 'application/json';
const PAYLOAD_TYPE = 'kb_items';

export function setItemDragData(e, { fileIds = [], folderIds = [] }) {
  e.dataTransfer.setData(MIME, JSON.stringify({ type: PAYLOAD_TYPE, fileIds, folderIds }));
  e.dataTransfer.effectAllowed = 'move';
}

/**
 * True when the drag in progress looks like our payload.
 *
 * dragover/dragenter cannot read the payload itself — the spec exposes only
 * the type list there and getData() returns "" until drop — so this checks
 * the MIME type alone. A drop handler must therefore still validate the
 * decoded payload rather than trusting this.
 */
export function isItemDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes(MIME);
}

/**
 * Decode a drop event. Returns { fileIds, folderIds } or null when the drop
 * isn't ours (an OS file drag for upload, plain text, another app).
 */
export function getDraggedItems(e) {
  const raw = e.dataTransfer?.getData(MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type !== PAYLOAD_TYPE) return null;
    const fileIds = Array.isArray(parsed.fileIds) ? parsed.fileIds : [];
    const folderIds = Array.isArray(parsed.folderIds) ? parsed.folderIds : [];
    if (fileIds.length === 0 && folderIds.length === 0) return null;
    return { fileIds, folderIds };
  } catch {
    return null;
  }
}

/**
 * Collect a folder's id and every descendant id, from the nested tree the
 * app already holds. Dropping a folder onto itself or into its own subtree
 * would orphan that subtree (its parent chain would loop, so the tree walk
 * could never reach it again). The server rejects this too — this is what
 * lets the UI refuse the drop up front instead of showing an error toast.
 */
export function collectFolderSubtreeIds(folders, folderId, acc = new Set()) {
  for (const node of folders || []) {
    if (node.id === folderId) {
      const walk = (n) => {
        acc.add(n.id);
        (n.children || []).forEach(walk);
      };
      walk(node);
      return acc;
    }
    if (node.children?.length) collectFolderSubtreeIds(node.children, folderId, acc);
  }
  return acc;
}

/**
 * Whether dropping the dragged items onto `targetFolderId` (null = root) is
 * a legal, non-pointless move.
 */
export function canDropOnFolder({ folderIds = [] }, targetFolderId, folders) {
  for (const draggedId of folderIds) {
    if (draggedId === targetFolderId) return false; // onto itself
    if (collectFolderSubtreeIds(folders, draggedId).has(targetFolderId)) return false; // into own subtree
  }
  return true;
}
