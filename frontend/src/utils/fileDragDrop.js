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

// The source workspace is additionally encoded as its own MIME type, because
// dragover cannot read the payload — the spec exposes only the type list
// there, and getData() returns "" until drop. Putting the id in the type name
// is what lets a target decide during the drag whether this will be a move or
// a copy, and show the right cursor for it.
const WS_TYPE_PREFIX = 'application/x-kb-ws-';

export function setItemDragData(e, { fileIds = [], folderIds = [], label, count, workspaceId = null, sourceFolderId = null } = {}) {
  // workspaceId travels with the payload because a drop target can belong to a
  // different workspace than the drag started in (a folder window can show
  // any workspace). The target compares the two to decide whether the drop is
  // a move within one workspace or a copy across two.
  //
  // sourceFolderId travels for undo. Where an item came from was read off the
  // main explorer's own file list, which does not contain a file dragged out
  // of a folder window — so those moves recorded no origin and "되돌리기"
  // reported success while putting nothing back.
  e.dataTransfer.setData(MIME, JSON.stringify({ type: PAYLOAD_TYPE, fileIds, folderIds, workspaceId, sourceFolderId }));
  e.dataTransfer.setData(`${WS_TYPE_PREFIX}${workspaceId || 'none'}`, '1');
  e.dataTransfer.effectAllowed = 'copyMove';
  if (label) setDragLabel(e, label, count ?? (fileIds.length + folderIds.length));
}

/**
 * Replace the browser's default drag ghost (a translucent snapshot of the
 * whole card) with a small chip naming what is being dragged, so the pointer
 * carries a readable label instead of an anonymous smear.
 *
 * The element has to be in the document for setDragImage to rasterise it, so
 * it is positioned off-screen and removed on the next tick — by then the
 * browser has already taken its snapshot.
 */
function setDragLabel(e, label, count) {
  try {
    const chip = document.createElement('div');
    chip.textContent = count > 1 ? `${label} 외 ${count - 1}개` : label;
    Object.assign(chip.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      maxWidth: '320px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      padding: '6px 10px',
      borderRadius: '6px',
      background: 'var(--bg-secondary, #1e293b)',
      color: 'var(--text-primary, #f1f5f9)',
      border: '1px solid var(--accent-primary, #3b82f6)',
      font: '600 12px/1.2 var(--font-sans, system-ui, sans-serif)',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
    });
    document.body.appendChild(chip);
    e.dataTransfer.setDragImage(chip, 12, 12);
    setTimeout(() => chip.remove(), 0);
  } catch {
    // setDragImage is unsupported in a few environments — the default ghost
    // is a fine fallback, so never let this break the drag itself.
  }
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
 * Decode a drop event. Returns { fileIds, folderIds, workspaceId } or null when
 * the drop isn't ours (an OS file drag for upload, plain text, another app).
 * workspaceId is null for payloads written before it was carried.
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
    return {
      fileIds,
      folderIds,
      workspaceId: parsed.workspaceId ?? null,
      sourceFolderId: parsed.sourceFolderId ?? null,
    };
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
export function canDropOnFolder({ folderIds = [], workspaceId = null } = {}, targetFolderId, folders, targetWorkspaceId = undefined) {
  // Crossing workspaces copies rather than moves, so the containment rules
  // below cannot apply: the source tree is in a different workspace entirely
  // and `folders` describes only one of them.
  if (targetWorkspaceId !== undefined && workspaceId && workspaceId !== targetWorkspaceId) return true;
  for (const draggedId of folderIds) {
    if (draggedId === targetFolderId) return false; // onto itself
    if (collectFolderSubtreeIds(folders, draggedId).has(targetFolderId)) return false; // into own subtree
  }
  return true;
}

/**
 * The dragged items' source workspace, readable mid-drag (see WS_TYPE_PREFIX).
 * Shaped like a payload so it can be handed straight to dropIntent.
 */
export function getDragWorkspaceHint(e) {
  const types = Array.from(e.dataTransfer?.types || []);
  const hit = types.find((t) => t.startsWith(WS_TYPE_PREFIX));
  if (!hit) return { workspaceId: null };
  const id = hit.slice(WS_TYPE_PREFIX.length);
  return { workspaceId: id === 'none' ? null : id };
}

/**
 * What a drop should do: a move inside one workspace, a copy across two.
 * Mirrors dragging between folders on one drive versus between two drives —
 * the second cannot be a rename, so it has to duplicate.
 */
export function dropIntent(items, targetWorkspaceId) {
  const source = items?.workspaceId ?? null;
  if (source && targetWorkspaceId && source !== targetWorkspaceId) {
    return { mode: 'copy', sourceWorkspaceId: source };
  }
  return { mode: 'move', sourceWorkspaceId: source };
}
