import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder as FolderIcon,
  ChevronRight,
  Home,
  Minus,
  Maximize2,
  X,
  RefreshCw,
  Loader2,
  UploadCloud,
  ArrowUpDown,
} from '../../utils/icons';
import { folderIconColor } from '../../utils/folderColors';
import { listFolders, listFiles } from '../../api';
import { setItemDragData, isItemDrag, getDraggedItems, canDropOnFolder, dropIntent, getDragWorkspaceHint } from '../../utils/fileDragDrop';
import { useMarqueeSelection } from '../../hooks/useMarqueeSelection';
import { useWindowChrome, RESIZE_DIRECTIONS } from '../../hooks/useWindowChrome';

// A window lists its folder in one go rather than paginating: it is a working
// surface for moving things between places, and a page control would make a
// selection silently span items that are no longer shown. Capped at the
// listing API's own maximum page_size — asking for more is a 422, not a
// larger page.
const MAX_ROWS = 200;

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export default function FolderWindow({
  windowState,
  workspaces = [],
  activeWorkspaceId = null,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onPositionChange,
  onSizeChange,
  onNavigate,
  onOpenFile,
  onFileContextMenu,
  onFolderContextMenu,
  onBackgroundContextMenu,
  clipboard = null,
  onClipboardCut,
  onClipboardCopy,
  onClipboardPaste,
  onTransferItems,
  onUploadFiles,
  externalRefreshToken = 0,
}) {
  const { id, folderId, workspaceId, position, size, isMinimized, isMaximized, zIndex } = windowState;

  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [dropTargetKey, setDropTargetKey] = useState(null);
  // Whether the drag currently hovering would copy rather than move. The
  // native copy cursor is easy to miss, so the target says so in the UI too.
  const [dropIsCopy, setDropIsCopy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // Sorting is per window: two windows onto different folders are usually open
  // for different reasons, and forcing them to share one order would make the
  // second one useless the moment the first is changed.
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  const bodyRef = useRef(null);
  const marqueeBaseRef = useRef({ files: [], folders: [] });
  const anchorRef = useRef(null);

  const { isInteracting, handleDragStart, handleResizeStart } = useWindowChrome({
    id, position, size, isMaximized, onFocus, onPositionChange, onSizeChange,
  });

  // ---- data -----------------------------------------------------------------
  // The whole workspace's folder list is fetched, not just this folder's
  // children: the breadcrumb walks up through it and the drop rules need the
  // subtree of any folder being dragged, neither of which a single level gives.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    (async () => {
      // Settled, not all-or-nothing: the two listings are independent, and
      // letting one failure blank the other would leave the window showing an
      // empty folder that is not empty.
      const [folderRes, fileRes] = await Promise.allSettled([
        listFolders({ workspace_id: workspaceId }),
        listFiles({ workspace_id: workspaceId, folder_id: folderId, page_size: MAX_ROWS, paged: true }),
      ]);
      if (cancelled) return;

      if (folderRes.status === 'fulfilled') {
        const v = folderRes.value;
        setFolders(Array.isArray(v) ? v : (v.items || []));
      }
      if (fileRes.status === 'fulfilled') {
        const v = fileRes.value;
        setFiles(Array.isArray(v) ? v : (v.items || []));
      }

      const failed = [folderRes, fileRes].filter((r) => r.status === 'rejected');
      setLoadError(failed.length ? (failed[0].reason?.message || '불러오지 못했습니다.') : null);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [workspaceId, folderId, reloadToken, externalRefreshToken]);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  const compare = useCallback((a, b) => {
    const dir = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'size') return dir * ((a.size_bytes || 0) - (b.size_bytes || 0));
    if (sortBy === 'updated') return dir * (new Date(a.updated_at || 0) - new Date(b.updated_at || 0));
    return dir * String(a.name || '').localeCompare(String(b.name || ''));
  }, [sortBy, sortOrder]);

  const subfolders = useMemo(
    () => folders
      .filter((f) => (f.parent_id || null) === (folderId || null))
      .slice()
      .sort(compare)
      .slice(0, MAX_ROWS),
    [folders, folderId, compare]
  );

  const sortedFiles = useMemo(() => files.slice().sort(compare), [files, compare]);

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const currentFolder = folderId ? folderById.get(folderId) : null;

  const breadcrumb = useMemo(() => {
    const path = [];
    let node = currentFolder;
    const seen = new Set();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      path.unshift(node);
      node = node.parent_id ? folderById.get(node.parent_id) : null;
    }
    return path;
  }, [currentFolder, folderById]);

  // The tree shape canDropOnFolder expects, built from the flat list.
  const folderTree = useMemo(() => {
    const nodes = new Map(folders.map((f) => [f.id, { ...f, children: [] }]));
    const roots = [];
    nodes.forEach((n) => {
      const parent = n.parent_id ? nodes.get(n.parent_id) : null;
      if (parent) parent.children.push(n);
      else roots.push(n);
    });
    return roots;
  }, [folders]);

  const workspaceName = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.name || '',
    [workspaces, workspaceId]
  );
  const isForeignWorkspace = !!activeWorkspaceId && workspaceId !== activeWorkspaceId;

  // The taskbar labels this window from windowState.folderName, which a
  // restored window starts without — only the listing knows it. Reported back
  // once resolved so the dock does not sit on a blank tab.
  const resolvedName = folderId ? (currentFolder?.name || '') : '홈';
  useEffect(() => {
    if (resolvedName && resolvedName !== windowState.folderName) {
      onNavigate?.(id, folderId, resolvedName);
    }
  }, [resolvedName, windowState.folderName, id, folderId, onNavigate]);

  // ---- selection ------------------------------------------------------------
  const clearSelection = useCallback(() => {
    setSelectedFileIds([]);
    setSelectedFolderIds([]);
    anchorRef.current = null;
  }, []);

  useEffect(() => { clearSelection(); }, [folderId, workspaceId, clearSelection]);

  const orderedItems = useMemo(() => [
    ...subfolders.map((f) => ({ kind: 'folder', id: f.id })),
    ...sortedFiles.map((f) => ({ kind: 'file', id: f.id })),
  ], [subfolders, sortedFiles]);

  const selectRangeTo = (kind, itemId, additive) => {
    const idx = orderedItems.findIndex((i) => i.kind === kind && i.id === itemId);
    const anchor = anchorRef.current;
    const anchorIdx = anchor ? orderedItems.findIndex((i) => i.kind === anchor.kind && i.id === anchor.id) : -1;
    if (idx === -1 || anchorIdx === -1) {
      anchorRef.current = { kind, id: itemId };
      setSelectedFileIds(kind === 'file' ? (additive ? (p) => [...new Set([...p, itemId])] : [itemId]) : (additive ? (p) => p : []));
      setSelectedFolderIds(kind === 'folder' ? (additive ? (p) => [...new Set([...p, itemId])] : [itemId]) : (additive ? (p) => p : []));
      return;
    }
    const [from, to] = anchorIdx <= idx ? [anchorIdx, idx] : [idx, anchorIdx];
    const range = orderedItems.slice(from, to + 1);
    const rf = range.filter((i) => i.kind === 'file').map((i) => i.id);
    const ro = range.filter((i) => i.kind === 'folder').map((i) => i.id);
    setSelectedFileIds((p) => (additive ? [...new Set([...p, ...rf])] : rf));
    setSelectedFolderIds((p) => (additive ? [...new Set([...p, ...ro])] : ro));
  };

  const toggleFile = (fileId) => {
    anchorRef.current = { kind: 'file', id: fileId };
    setSelectedFileIds((p) => (p.includes(fileId) ? p.filter((x) => x !== fileId) : [...p, fileId]));
  };
  const toggleFolder = (fid) => {
    anchorRef.current = { kind: 'folder', id: fid };
    setSelectedFolderIds((p) => (p.includes(fid) ? p.filter((x) => x !== fid) : [...p, fid]));
  };

  const { onMouseDown: startMarquee, marqueeRect } = useMarqueeSelection({
    containerRef: bodyRef,
    onClearSelection: clearSelection,
    onChange: useCallback((fileIds, folderIds, additive) => {
      if (additive) {
        setSelectedFileIds([...new Set([...marqueeBaseRef.current.files, ...fileIds])]);
        setSelectedFolderIds([...new Set([...marqueeBaseRef.current.folders, ...folderIds])]);
      } else {
        setSelectedFileIds(fileIds);
        setSelectedFolderIds(folderIds);
      }
    }, []),
  });

  const handleBodyMouseDown = (e) => {
    marqueeBaseRef.current = { files: selectedFileIds, folders: selectedFolderIds };
    startMarquee(e);
  };

  const selectedCount = selectedFileIds.length + selectedFolderIds.length;
  const effectiveSelection = (item, kind) => {
    const inSelection = kind === 'folder' ? selectedFolderIds.includes(item.id) : selectedFileIds.includes(item.id);
    if (inSelection) return { fileIds: selectedFileIds, folderIds: selectedFolderIds };
    return kind === 'folder' ? { fileIds: [], folderIds: [item.id] } : { fileIds: [item.id], folderIds: [] };
  };

  const isCut = (kind, itemId) => clipboard?.mode === 'cut'
    && clipboard.workspaceId === workspaceId
    && (kind === 'folder' ? clipboard.folderIds.includes(itemId) : clipboard.fileIds.includes(itemId));

  // ---- keyboard, scoped to the focused window -------------------------------
  // Bound to this window's own element rather than the document, so the
  // shortcuts act on whichever window has focus instead of every window (and
  // the main explorer) reacting to the same keypress.
  const handleKeyDown = (e) => {
    const el = document.activeElement;
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 'a') {
      e.preventDefault(); e.stopPropagation();
      setSelectedFileIds(files.map((f) => f.id));
      setSelectedFolderIds(subfolders.map((f) => f.id));
      return;
    }
    if (mod && key === 'x' && selectedCount) {
      e.preventDefault(); e.stopPropagation();
      onClipboardCut?.(selectedFileIds, selectedFolderIds, workspaceId);
      return;
    }
    if (mod && key === 'c' && selectedCount) {
      e.preventDefault(); e.stopPropagation();
      onClipboardCopy?.(selectedFileIds, selectedFolderIds, workspaceId);
      return;
    }
    if (mod && key === 'v') {
      e.preventDefault(); e.stopPropagation();
      onClipboardPaste?.(folderId, workspaceId, refresh);
      return;
    }
    if (e.key === 'Escape' && selectedCount) {
      e.stopPropagation();
      clearSelection();
    }
  };

  // ---- drops ----------------------------------------------------------------
  const dropProps = (targetFolderId, key) => ({
    onDragOver: (e) => {
      if (!isItemDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      // Crossing workspaces duplicates rather than moves, so the cursor says
      // so — the browser draws the copy badge for 'copy'. Without this every
      // drop looks like a move right up until it isn't.
      const crossing = dropIntent(getDragWorkspaceHint(e), workspaceId).mode === 'copy';
      e.dataTransfer.dropEffect = crossing ? 'copy' : 'move';
      if (dropTargetKey !== key) setDropTargetKey(key);
      if (dropIsCopy !== crossing) setDropIsCopy(crossing);
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDropTargetKey((prev) => (prev === key ? null : prev));
    },
    onDrop: async (e) => {
      setDropTargetKey(null);
      const items = getDraggedItems(e);
      if (!items) return;
      e.preventDefault();
      e.stopPropagation();
      if (!canDropOnFolder(items, targetFolderId, folderTree, workspaceId)) return;
      const intent = dropIntent(items, workspaceId);
      await onTransferItems?.({
        fileIds: items.fileIds,
        folderIds: items.folderIds,
        sourceWorkspaceId: intent.sourceWorkspaceId || workspaceId,
        targetWorkspaceId: workspaceId,
        targetFolderId,
        mode: intent.mode,
      });
      clearSelection();
      refresh();
    },
    'data-drop-active': dropTargetKey === key ? 'true' : undefined,
    'data-drop-copy': dropTargetKey === key && dropIsCopy ? 'true' : undefined,
  });

  const startItemDrag = (e, item, kind) => {
    e.stopPropagation();
    const sel = effectiveSelection(item, kind);
    setItemDragData(e, {
      fileIds: sel.fileIds,
      folderIds: sel.folderIds,
      label: item.name,
      count: sel.fileIds.length + sel.folderIds.length,
      workspaceId,
    });
  };

  if (isMinimized) return null;

  const rows = [
    ...subfolders.map((f) => ({ kind: 'folder', item: f })),
    ...sortedFiles.map((f) => ({ kind: 'file', item: f })),
  ];

  return (
    <div
      className={`os-preview-window folder-window ${isInteracting ? 'is-interacting' : ''}`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate(${position.x}px, ${position.y}px)`,
        width: size.width,
        height: size.height,
        zIndex,
        transition: isInteracting ? 'box-shadow 0.2s ease' : undefined,
      }}
      onMouseDown={() => onFocus(id)}
    >
      <div className="os-window-header" onMouseDown={handleDragStart} onDoubleClick={() => onMaximize(id)}>
        <div className="window-title-box" title={currentFolder?.name || '홈'}>
          <div className="window-file-icon"><FolderIcon size={15} color="var(--accent-primary)" /></div>
          <span className="window-title-text">{currentFolder?.name || '홈'}</span>
          {/* A window can show a workspace other than the one the app is
              switched to, and which one it is changes what a drop does — so it
              is named in the title rather than left to be inferred. */}
          {isForeignWorkspace && workspaceName && (
            <span className="fw-workspace-chip" title={`${workspaceName} 워크스페이스`}>{workspaceName}</span>
          )}
        </div>
        <div className="window-header-actions">
          <button
            type="button"
            className="window-action-btn icon-only"
            title={`정렬: ${sortBy === 'name' ? '이름' : sortBy === 'size' ? '크기' : '수정일'} ${sortOrder === 'asc' ? '오름차순' : '내림차순'} (클릭하여 변경)`}
            onClick={(e) => {
              e.stopPropagation();
              // One control cycling name → size → updated, flipping direction
              // on the way round. A window header has no room for a select,
              // and this keeps every order reachable in at most six clicks.
              if (sortOrder === 'asc') setSortOrder('desc');
              else {
                setSortOrder('asc');
                setSortBy((prev) => (prev === 'name' ? 'size' : prev === 'size' ? 'updated' : 'name'));
              }
            }}
          >
            <ArrowUpDown size={13} />
          </button>
          <button
            type="button"
            className="window-action-btn icon-only"
            title="이 폴더에 파일 업로드"
            disabled={isUploading}
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            {isUploading ? <Loader2 size={13} className="spin" /> : <UploadCloud size={13} />}
          </button>
          <button type="button" className="window-action-btn icon-only" title="새로고침" onClick={(e) => { e.stopPropagation(); refresh(); }}>
            <RefreshCw size={13} />
          </button>
          <div className="window-header-divider" />
          <div className="window-os-controls" style={{ display: 'flex', gap: 3 }}>
            <button type="button" className="window-action-btn icon-only" title="최소화" onClick={(e) => { e.stopPropagation(); onMinimize(id); }}>
              <Minus size={13} />
            </button>
            <button type="button" className="window-action-btn icon-only" title="최대화" onClick={(e) => { e.stopPropagation(); onMaximize(id); }}>
              <Maximize2 size={13} />
            </button>
            <button type="button" className="window-action-btn icon-only" title="닫기" onClick={(e) => { e.stopPropagation(); onClose(id); }}>
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Breadcrumb — each segment is a drop target, so items can be moved to
          an ancestor without navigating there first. */}
      {/* Uploads land in the folder this window is showing, which may be in a
          different workspace than the app is switched to — so the window does
          its own upload rather than borrowing the main explorer's. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={async (e) => {
          const picked = Array.from(e.target.files || []);
          e.target.value = '';
          if (!picked.length || !onUploadFiles) return;
          setIsUploading(true);
          try {
            await onUploadFiles(picked, folderId, workspaceId);
            refresh();
          } finally {
            setIsUploading(false);
          }
        }}
      />

      <div className="fw-breadcrumb">
        <button
          type="button"
          className={`fw-crumb ${!folderId ? 'current' : ''}`}
          onClick={() => onNavigate(id, null, '홈')}
          {...dropProps(null, 'crumb-root')}
        >
          <Home size={12} />
          <span>홈</span>
        </button>
        {breadcrumb.map((node) => (
          <React.Fragment key={node.id}>
            <ChevronRight size={11} className="fw-crumb-sep" />
            <button
              type="button"
              className={`fw-crumb ${node.id === folderId ? 'current' : ''}`}
              onClick={() => onNavigate(id, node.id, node.name)}
              {...dropProps(node.id, `crumb-${node.id}`)}
            >
              {node.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div
        ref={bodyRef}
        className="os-window-body fw-body"
        onMouseDown={handleBodyMouseDown}
        onContextMenu={(e) => {
          if (e.target.closest('[data-select-id]')) return;
          e.preventDefault();
          e.stopPropagation();
          onBackgroundContextMenu?.(e, { folderId, workspaceId, onDone: refresh });
        }}
        {...dropProps(folderId, 'body')}
      >
        {isLoading ? (
          <div className="fw-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>
        ) : loadError && rows.length === 0 ? (
          <div className="fw-empty"><span>{loadError}</span></div>
        ) : rows.length === 0 ? (
          <div className="fw-empty"><span>이 폴더는 비어 있습니다.</span></div>
        ) : (
          rows.map(({ kind, item }) => {
            const selected = kind === 'folder' ? selectedFolderIds.includes(item.id) : selectedFileIds.includes(item.id);
            return (
              <div
                key={`${kind}-${item.id}`}
                className={`fw-row ${selected ? 'selected' : ''} ${isCut(kind, item.id) ? 'is-cut' : ''}`}
                data-select-id={item.id}
                data-select-kind={kind}
                draggable
                onDragStart={(e) => startItemDrag(e, item, kind)}
                onClick={(e) => {
                  if (e.shiftKey) { e.stopPropagation(); selectRangeTo(kind, item.id, e.ctrlKey || e.metaKey); return; }
                  if (e.ctrlKey || e.metaKey) { e.stopPropagation(); kind === 'folder' ? toggleFolder(item.id) : toggleFile(item.id); return; }
                  if (kind === 'folder') onNavigate(id, item.id, item.name);
                  else onOpenFile?.(item);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const sel = effectiveSelection(item, kind);
                  const ctx = { folderId, workspaceId, onDone: refresh, selection: sel };
                  if (kind === 'folder') onFolderContextMenu?.(e, item, ctx);
                  else onFileContextMenu?.(e, item, ctx);
                }}
                {...(kind === 'folder' ? dropProps(item.id, `row-${item.id}`) : {})}
              >
                <span className="fw-row-icon">
                  {kind === 'folder'
                    ? <FolderIcon size={15} color={folderIconColor(item)} />
                    : <span className="fw-file-dot" />}
                </span>
                <span className="fw-row-name" title={item.name}>{item.name}</span>
                <span className="fw-row-meta">
                  {kind === 'folder'
                    ? (item.file_count ? `${item.file_count}개` : '')
                    : formatSize(item.size_bytes)}
                </span>
              </div>
            );
          })
        )}

        {/* Says what the drop will do while it can still be reconsidered.
            Crossing workspaces duplicates rather than moves, and the native
            copy cursor is a small badge that is easy to miss. */}
        {dropTargetKey && dropIsCopy && (
          <div className="fw-drop-hint">다른 워크스페이스로 복사됩니다</div>
        )}

        {marqueeRect && (
          <div
            className="selection-marquee"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.right - marqueeRect.left,
              height: marqueeRect.bottom - marqueeRect.top,
            }}
          />
        )}
      </div>

      <div className="os-window-footer fw-footer">
        <span>
          {subfolders.length}개 폴더 · {files.length}개 파일
          {' · '}
          {sortBy === 'name' ? '이름순' : sortBy === 'size' ? '크기순' : '수정일순'}
          {sortOrder === 'asc' ? ' ↑' : ' ↓'}
        </span>
        {selectedCount > 0 && <span>{selectedCount}개 선택됨</span>}
      </div>

      {/* Same grab regions as the preview window: seven invisible edges plus
          the visible corner tick, so both windows resize identically. */}
      {!isMaximized && RESIZE_DIRECTIONS.map((dir) => (
        <div
          key={dir}
          className={dir === 'se' ? 'os-window-resize-handle edge-se' : `os-resize-edge edge-${dir}`}
          onMouseDown={handleResizeStart(dir)}
          onTouchStart={handleResizeStart(dir)}
          title="드래그하여 크기 조절"
        />
      ))}
    </div>
  );
}
