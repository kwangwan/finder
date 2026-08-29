import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Folder as FolderIcon, 
  FolderPlus, 
  FileText, 
  FilePlus, 
  UploadCloud, 
  ChevronRight, 
  ChevronDown, 
  Star, 
  Clock, 
  HardDrive, 
  Sparkles, 
  Layers,
  Settings,
  Trash2,
  ChevronsLeft
} from '../../utils/icons';
import WorkspaceSwitcher from '../workspace/WorkspaceSwitcher';
import { setItemDragData, isItemDrag, getDraggedItems, canDropOnFolder } from '../../utils/fileDragDrop';

export default function Sidebar({
  workspaces = [],
  activeWorkspace,
  isWorkspacesLoaded = true,
  onSelectWorkspace,
  onOpenCreateWorkspace,
  onOpenWorkspaceSettings,
  folders = [],
  isFoldersLoading = false,
  activeFolderId,
  onSelectFolder,
  activeView,
  onSelectView,
  onNewNote,
  onNewFolder,
  onOpenUpload,
  onFolderContextMenu,
  onDirectMoveItems,
  stats,
  isCollapsed,
  onToggleSidebar,
}) {
  const [expandedFolders, setExpandedFolders] = useState({});
  // The sidebar tree is a drop target for files/folders dragged from the
  // explorer (or from the tree itself). Tracked by id so only the row under
  // the pointer highlights.
  const [dropTargetId, setDropTargetId] = useState(null);
  // Hovering a collapsed folder for a moment expands it, so a drop can be
  // aimed at something nested without dropping and re-dragging first —
  // spring-loaded folders, the way desktop file managers behave.
  const expandTimerRef = useRef(null);

  const folderDropProps = (targetFolderId) => {
    const key = targetFolderId ?? 'root';
    return {
      onDragOver: (e) => {
        if (!isItemDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropTargetId !== key) setDropTargetId(key);
      },
      onDragEnter: () => {
        if (!targetFolderId) return;
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = setTimeout(() => {
          setExpandedFolders(prev => ({ ...prev, [targetFolderId]: true }));
        }, 700);
      },
      onDragLeave: (e) => {
        // Children bubble dragleave up; ignore those or the highlight
        // flickers as the pointer crosses the row's own icon/label.
        if (e.currentTarget.contains(e.relatedTarget)) return;
        clearTimeout(expandTimerRef.current);
        setDropTargetId(prev => (prev === key ? null : prev));
      },
      onDrop: (e) => {
        clearTimeout(expandTimerRef.current);
        setDropTargetId(null);
        const items = getDraggedItems(e);
        if (!items) return;
        e.preventDefault();
        e.stopPropagation();
        if (!canDropOnFolder(items, targetFolderId, folders)) return;
        if (onDirectMoveItems) onDirectMoveItems(items.fileIds, items.folderIds, targetFolderId);
      },
      'data-drop-active': dropTargetId === key ? 'true' : undefined,
    };
  };

  useEffect(() => () => clearTimeout(expandTimerRef.current), []);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('kb_sidebar_width');
    return saved ? Math.min(Math.max(parseInt(saved, 10), 200), 600) : 280;
  });
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  // Auto-expand parent folders of active folder so deep folders are always visible
  useEffect(() => {
    if (activeFolderId && folders.length > 0) {
      const parents = [];
      function findParents(nodes, targetId, currentPath = []) {
        for (const n of nodes) {
          if (n.id === targetId) {
            parents.push(...currentPath);
            return true;
          }
          if (n.children && n.children.length > 0) {
            if (findParents(n.children, targetId, [...currentPath, n.id])) {
              return true;
            }
          }
        }
        return false;
      }
      findParents(folders, activeFolderId);
      if (parents.length > 0) {
        setExpandedFolders(prev => {
          const next = { ...prev };
          parents.forEach(pId => { next[pId] = true; });
          return next;
        });
      }
    }
  }, [activeFolderId, folders]);

  // Sidebar drag resizer
  const startResizing = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
    isResizingRef.current = true;
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    isResizingRef.current = false;
  }, []);

  const resize = useCallback((e) => {
    if (isResizingRef.current) {
      const newWidth = Math.min(Math.max(e.clientX, 200), 600);
      setSidebarWidth(newWidth);
      localStorage.setItem('kb_sidebar_width', newWidth);
    }
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, resize, stopResizing]);

  const toggleExpand = (folderId, e) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  const renderFolderTreeNode = (folder) => {
    const isExpanded = expandedFolders[folder.id];
    const isSelected = activeFolderId === folder.id && activeView === 'folder';
    const hasChildren = folder.children && folder.children.length > 0;

    return (
      <div key={folder.id} className="tree-node">
        <div
          className={`tree-row ${isSelected ? 'active' : ''}`}
          draggable={true}
          onDragStart={(e) => {
            e.stopPropagation();
            setItemDragData(e, { folderIds: [folder.id], label: folder.name });
          }}
          onClick={() => onSelectFolder(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onFolderContextMenu) onFolderContextMenu(e, folder);
          }}
          {...folderDropProps(folder.id)}
        >
          {hasChildren ? (
            <span onClick={(e) => toggleExpand(folder.id, e)} style={{ display: 'flex', alignItems: 'center' }}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          ) : (
            <span style={{ width: 14 }} />
          )}
          <FolderIcon size={16} color={folder.color || (isSelected ? '#3b82f6' : '#94a3b8')} />
          <span title={folder.name}>{folder.name}</span>
          {folder.file_count > 0 && (
            <span className="menu-badge" style={{ marginLeft: 0 }}>{folder.file_count}</span>
          )}
          <button
            className="btn-icon tree-add-btn"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedFolders(prev => ({ ...prev, [folder.id]: true }));
              onNewFolder(folder.id);
            }}
            title="하위 폴더 추가"
            style={{
              padding: '0.15rem 0.25rem',
              marginLeft: '0.2rem',
              opacity: 0.6,
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <FolderPlus size={13} />
          </button>
        </div>

        {hasChildren && isExpanded && (
          <div className="tree-children">
            {folder.children.map(child => renderFolderTreeNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside 
      className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}
      style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
    >
      {/* Resizer Handle */}
      <div 
        className={`sidebar-resizer ${isResizing ? 'is-resizing' : ''}`}
        onMouseDown={startResizing}
        onDoubleClick={() => {
          setSidebarWidth(280);
          localStorage.setItem('kb_sidebar_width', 280);
        }}
        title="드래그하여 사이드바 너비 조절 (더블클릭 시 기본값 복원)"
      />

      {/* Brand Header */}
      <div className="sidebar-header" style={{ padding: '1rem 0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="brand">
          <div className="brand-icon">
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Finder</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 500 }}>
              Project Run
            </div>
          </div>
        </div>
        <button
          className="btn-icon"
          onClick={onToggleSidebar}
          title="사이드바 숨기기"
          style={{ flexShrink: 0 }}
        >
          <ChevronsLeft size={16} />
        </button>
      </div>

      {/* Slack-style Workspace Switcher */}
      <div style={{ padding: '0.75rem 0.85rem 0.25rem' }}>
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          isLoading={!isWorkspacesLoaded}
          onSelectWorkspace={onSelectWorkspace}
          onOpenCreateWorkspace={onOpenCreateWorkspace}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        />
      </div>

      {/* Quick Nav Section */}
      <div className="sidebar-section" style={{ padding: '0.65rem 0.85rem 0.3rem' }}>
        <span>빠른 탐색</span>
      </div>
      <ul className="sidebar-menu" style={{ padding: '0.15rem 0.85rem' }}>
        {/* Also the drop target for moving items back out to the workspace
            root — there is no tree row representing the root itself. */}
        <li
          className={`menu-item ${activeView === 'all' ? 'active' : ''}`}
          onClick={() => onSelectView('all')}
          {...folderDropProps(null)}
        >
          <Layers size={16} />
          <span>전체 파일</span>
          {!isFoldersLoading && stats?.total_files > 0 && <span className="menu-badge">{stats.total_files}</span>}
        </li>
        <li
          className={`menu-item ${activeView === 'notes' ? 'active' : ''}`}
          onClick={() => onSelectView('notes')}
        >
          <FileText size={16} />
          <span>문서</span>
          {!isFoldersLoading && stats?.note_count > 0 && <span className="menu-badge">{stats.note_count}</span>}
        </li>
        <li 
          className={`menu-item ${activeView === 'favorites' ? 'active' : ''}`}
          onClick={() => onSelectView('favorites')}
        >
          <Star size={16} />
          <span>즐겨찾기</span>
        </li>
        <li 
          className={`menu-item ${activeView === 'trash' ? 'active' : ''}`}
          onClick={() => onSelectView('trash')}
        >
          <Trash2 size={16} color="var(--accent-rose)" />
          <span>휴지통</span>
        </li>
      </ul>

      {/* Folders Hierarchy Tree */}
      <div className="sidebar-section" style={{ padding: '0.65rem 0.85rem 0.3rem' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="폴더 목록">
          폴더
        </span>
        <button 
          className="btn-icon" 
          onClick={() => onNewFolder(activeFolderId)}
          title="현재 폴더 아래 하위 폴더 생성"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      <div className="folder-tree" style={{ padding: '0.15rem 0.85rem' }}>
        <div className="folder-tree-inner">
          {isFoldersLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.25rem 0' }}>
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton-box" style={{ height: 28, borderRadius: 'var(--radius-sm)' }} />
              ))}
            </div>
          ) : folders.length === 0 ? (
            <div style={{ padding: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              생성된 폴더가 없습니다.
            </div>
          ) : (
            folders.map(folder => renderFolderTreeNode(folder))
          )}
        </div>
      </div>

      {/* Storage Footer Status */}
      {stats && (
        <div style={{ 
          padding: '0.75rem 0.85rem', 
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <HardDrive size={13} color="var(--accent-primary)" /> 저장소 상태
            </span>
            <span style={{ color: 'var(--accent-emerald)', fontWeight: 600, fontSize: '0.72rem' }}>
              ● 정상 연결됨
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
