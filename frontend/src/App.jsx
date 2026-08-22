import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import FolderExplorer from './components/explorer/FolderExplorer';
import NoteEditor from './components/editor/NoteEditor';
import SemanticSearchModal from './components/search/SemanticSearchModal';
import ChunkedUploadModal from './components/upload/ChunkedUploadModal';
import FileConflictModal from './components/upload/FileConflictModal';
import NewFolderModal from './components/modals/NewFolderModal';
import LoginModal from './components/auth/LoginModal';
import PendingApprovalScreen from './components/auth/PendingApprovalScreen';
import AdminDashboard from './components/admin/AdminDashboard';
import WorkspaceSettingsModal from './components/workspace/WorkspaceSettingsModal';
import MediaPreviewModal from './components/modals/MediaPreviewModal';
import InvitationManagerModal from './components/admin/InvitationManagerModal';
import TrashExplorer from './components/trash/TrashExplorer';
import ContextMenu from './components/common/ContextMenu';
import RenameModal from './components/modals/RenameModal';
import MoveFilesModal from './components/modals/MoveFilesModal';
import TransferManager from './components/transfer/TransferManager';
import WindowManager from './components/window/WindowManager';
import { useWindowManager } from './hooks/useWindowManager';
import UploadProgressBanner from './components/upload/UploadProgressBanner';
import { useUploadManager } from './hooks/useUploadManager';
import { 
  Folder as FolderIcon,
  FolderPlus,
  FileText,
  Plus,
  UploadCloud,
  Edit3,
  Trash2,
  RotateCcw,
  RefreshCw,
  Star,
  Download,
  Eye,
  FileArchive,
  FolderInput
} from './utils/icons';
import { 
  getMe,
  logout,
  listWorkspaces,
  getFolderTree, 
  listFiles,
  getFilesWatermark, 
  getFileDetail, 
  createMarkdownNote, 
  updateMarkdownNote, 
  deleteFile, 
  createFolder, 
  deleteFolder,
  updateFolder,
  getSystemStats,
  uploadFileChunked,
  moveToTrashFile,
  restoreFile,
  moveToTrashFolder,
  restoreFolder,
  renameFolder,
  renameFile,
  getFileDownloadUrl,
  downloadFileChunked,
  downloadFolderAsZip,
  batchDownloadFiles,
  batchMoveFiles
} from './api';
import { useDialog } from './context/DialogContext';
import { useToast } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';

// Helper to find folder and build breadcrumb path
function findFolderById(nodeList, id) {
  if (!nodeList || !id) return null;
  for (const node of nodeList) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findFolderById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function buildFolderPath(nodeList, targetId) {
  const path = [];
  function traverse(nodes, id) {
    if (!nodes) return false;
    for (const n of nodes) {
      if (n.id === id) {
        path.unshift(n);
        return true;
      }
      if (n.children && traverse(n.children, id)) {
        path.unshift(n);
        return true;
      }
    }
    return false;
  }
  if (targetId) traverse(nodeList, targetId);
  return path;
}

export default function App() {
  const { showAlert, showConfirm } = useDialog();
  const { showToast, updateToast, dismissToast } = useToast();
  const [theme, setTheme] = useState(() => localStorage.getItem('kb_theme') || 'dark');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  
  // Auth State
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Workspaces State
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(() => {
    try {
      const cached = localStorage.getItem('kb_active_ws_data');
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  });
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [isCreateWorkspaceMode, setIsCreateWorkspaceMode] = useState(false);

  const updateUrlParams = useCallback(({ wsId, folderId, view }) => {
    try {
      const url = new URL(window.location.href);
      if (wsId !== undefined) {
        if (wsId) url.searchParams.set('ws', wsId);
        else url.searchParams.delete('ws');
      }
      if (folderId !== undefined) {
        if (folderId) url.searchParams.set('folder', folderId);
        else url.searchParams.delete('folder');
      }
      if (view !== undefined) {
        if (view && view !== 'all' && view !== 'folder') url.searchParams.set('view', view);
        else url.searchParams.delete('view');
      }
      window.history.replaceState(null, '', url.toString());
    } catch (e) {}
  }, []);

  // Navigation & View (Initialize from URL query params)
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('folder') || null;
    } catch (e) {
      return null;
    }
  });
  const [activeView, setActiveView] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlFolder = params.get('folder');
      const urlView = params.get('view');
      if (urlFolder) return 'folder';
      if (urlView) return urlView;
      return 'all';
    } catch (e) {
      return 'all';
    }
  });

  const activeFolderIdRef = useRef(activeFolderId);
  const activeViewRef = useRef(activeView);
  const isInitialFolderRestoredRef = useRef(false);

  useEffect(() => {
    activeFolderIdRef.current = activeFolderId;
  }, [activeFolderId]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  // True once a background upload lands a file in the folder currently being
  // viewed. Deliberately does NOT trigger an auto-refresh of the file list —
  // with the default "최근 수정일순" sort, silently refetching would keep
  // bumping the user's current page's files onto later pages as new arrivals
  // take the top slots, making files the user is looking at seem to vanish
  // even though they still exist. Surface a "새 파일이 추가되었습니다" prompt
  // instead and let the user choose when to refresh.
  const [hasNewFilesInView, setHasNewFilesInView] = useState(false);

  const [files, setFiles] = useState([]);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const [activeFile, setActiveFile] = useState(null);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Sorting & Pagination State
  const [sortBy, setSortBy] = useState('updated_at'); // 'name' | 'file_type' | 'updated_at' | 'created_at' | 'size_bytes'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [paginationMeta, setPaginationMeta] = useState({
    total_count: 0,
    total_pages: 1,
    page: 1,
    page_size: 20
  });

  // Modals & Popups
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState(null);
  const [isInvitationModalOpen, setIsInvitationModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState({ isOpen: false, x: 0, y: 0, items: [] });
  const [renameModal, setRenameModal] = useState({ isOpen: false, item: null });

  // OS-Style Multi-Window Manager
  const windowManager = useWindowManager();

  const refreshDebounceTimerRef = useRef(null);

  // Persistent Upload Manager
  const uploadManager = useUploadManager({
    onUploadSuccess: (completedItem) => {
      if (refreshDebounceTimerRef.current) {
        clearTimeout(refreshDebounceTimerRef.current);
      }
      refreshDebounceTimerRef.current = setTimeout(() => {
        if (!completedItem || !completedItem.activeWorkspaceId || completedItem.activeWorkspaceId === activeWorkspace?.id) {
          refreshFoldersAndStats();
          const viewingUploadedFolder =
            (activeViewRef.current === 'folder' && (completedItem?.targetFolderId || null) === (activeFolderIdRef.current || null)) ||
            (activeViewRef.current === 'all' && !completedItem?.targetFolderId);
          // An empty view going from 0 files to some isn't disruptive the way
          // reshuffling an already-populated, paginated page is — let that
          // case keep auto-refreshing so files still "just appear" as the
          // empty-state message promises.
          // Only touch the file list at all if this upload actually landed in
          // the folder being viewed — refetching it for every completion
          // anywhere else in a multi-thousand-file batch was pure wasted load
          // (on both this tab and the backend) for a view that never changed.
          if (viewingUploadedFolder) {
            if (filesRef.current.length > 0) {
              // Don't silently refetch a folder the user is currently looking
              // at — with the default recency sort, that would keep bumping
              // whatever they're looking at onto later pages as new arrivals
              // take the top slots. Let them choose when to refresh instead.
              setHasNewFilesInView(true);
            } else {
              refreshFiles(true);
            }
          }
        }
      }, 300);
    }
  });

  // Viewing a different folder/view makes any pending "new files" prompt
  // moot — the normal refreshFiles effect already refetches on this change.
  useEffect(() => {
    setHasNewFilesInView(false);
  }, [activeFolderId, activeView]);

  // Sync theme
  useEffect(() => {
    const validThemes = ['dark', 'light', 'matrix'];
    const activeTheme = validThemes.includes(theme) ? theme : 'dark';
    document.documentElement.setAttribute('data-theme', activeTheme);
    localStorage.setItem('kb_theme', activeTheme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'matrix';
      return 'dark';
    });
  };

  const handleSetTheme = (newTheme) => {
    setTheme(newTheme);
  };

  // Check initial authentication
  const checkAuth = useCallback(async () => {
    setIsAuthLoading(true);
    try {
      const user = await getMe();
      setCurrentUser(user);
    } catch (err) {
      console.warn('Auth check error:', err);
      setCurrentUser(null);
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const [isWorkspacesLoaded, setIsWorkspacesLoaded] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const abortControllersRef = useRef(new Map());

  const addTransfer = (item) => {
    setTransfers(prev => [item, ...prev.filter(t => t.id !== item.id)]);
  };

  const updateTransfer = (id, updates) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleCancelTransfer = (id) => {
    if (abortControllersRef.current.has(id)) {
      abortControllersRef.current.get(id).abort();
      abortControllersRef.current.delete(id);
    }
    setTransfers(prev => prev.filter(t => t.id !== id));
  };

  const handleClearCompletedTransfers = () => {
    setTransfers(prev => prev.filter(t => t.status === 'running' || t.status === 'pending'));
  };

  const startDownloadFile = async (file) => {
    const transferId = `file-${file.id}-${Date.now()}`;
    const controller = new AbortController();
    abortControllersRef.current.set(transferId, controller);

    addTransfer({
      id: transferId,
      type: 'download',
      name: file.name,
      size: file.size_bytes,
      percent: 5,
      status: 'running',
      statusText: '다운로드 준비 중...',
      rawFile: file,
    });

    try {
      if (file.s3_key) {
        await downloadFileChunked(
          file.id,
          file.name,
          file.size_bytes,
          ({ percent, status }) => {
            updateTransfer(transferId, { percent, statusText: status });
          },
          controller.signal
        );
      } else if (file.content) {
        const blob = new Blob([file.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      updateTransfer(transferId, { percent: 100, status: 'completed', statusText: '다운로드 완료' });
    } catch (err) {
      if (controller.signal.aborted) {
        handleCancelTransfer(transferId);
        return;
      }
      console.error('File download error:', err);
      updateTransfer(transferId, {
        status: 'error',
        statusText: `실패: ${err.message}`,
        retryFn: () => startDownloadFile(file),
      });
    } finally {
      abortControllersRef.current.delete(transferId);
    }
  };

  const startDownloadFolder = async (folder) => {
    const transferId = `folder-${folder.id}-${Date.now()}`;
    const controller = new AbortController();
    abortControllersRef.current.set(transferId, controller);

    addTransfer({
      id: transferId,
      type: 'zip_download',
      name: `${folder.name}.zip`,
      percent: 10,
      status: 'running',
      statusText: '서버에서 폴더 압축 중...',
      rawFolder: folder,
    });

    try {
      await downloadFolderAsZip(
        folder.id,
        folder.name,
        ({ percent, status }) => {
          updateTransfer(transferId, { percent, statusText: status });
        },
        controller.signal
      );
      updateTransfer(transferId, { percent: 100, status: 'completed', statusText: 'ZIP 다운로드 완료' });
    } catch (err) {
      if (controller.signal.aborted) {
        handleCancelTransfer(transferId);
        return;
      }
      console.error('Folder zip download error:', err);
      updateTransfer(transferId, {
        status: 'error',
        statusText: `실패: ${err.message}`,
        retryFn: () => startDownloadFolder(folder),
      });
    } finally {
      abortControllersRef.current.delete(transferId);
    }
  };

  const handleRetryTransfer = (item) => {
    if (item.retryFn) {
      item.retryFn();
    } else if (item.rawFile) {
      startDownloadFile(item.rawFile);
    } else if (item.rawFolder) {
      startDownloadFolder(item.rawFolder);
    }
  };

  const [moveFilesModal, setMoveFilesModal] = useState({ isOpen: false, fileIds: [] });

  const handleOpenMoveModal = (fileIds) => {
    if (!fileIds || fileIds.length === 0) return;
    setMoveFilesModal({ isOpen: true, fileIds });
  };

  const handleConfirmMoveFiles = async (targetFolderId) => {
    if (!activeWorkspace?.id || !moveFilesModal.fileIds.length) return;
    try {
      const res = await batchMoveFiles(activeWorkspace.id, moveFilesModal.fileIds, targetFolderId);
      await refreshFiles();
      await refreshFoldersAndStats();
      showToast(`${res.moved_count}개의 파일이 이동되었습니다.`, { type: 'success' });
    } catch (err) {
      await showAlert({
        title: '이동 실패',
        message: '파일 이동 중 오류가 발생했습니다: ' + err.message,
        type: 'error',
      });
    }
  };

  const handleDirectMoveFiles = async (fileIds, targetFolderId) => {
    if (!activeWorkspace?.id || !fileIds.length) return;
    try {
      const res = await batchMoveFiles(activeWorkspace.id, fileIds, targetFolderId);
      await refreshFiles();
      await refreshFoldersAndStats();
      showToast(`${res.moved_count}개의 파일이 이동되었습니다.`, { type: 'success' });
    } catch (err) {
      await showAlert({
        title: '이동 실패',
        message: '파일 이동 중 오류가 발생했습니다: ' + err.message,
        type: 'error',
      });
    }
  };

  const handleBatchTrashFiles = async (fileIds, onConfirmed) => {
    if (!fileIds || fileIds.length === 0) return false;
    const confirmed = await showConfirm({
      title: '파일 일괄 삭제',
      message: `선택한 ${fileIds.length}개 파일을 휴지통으로 이동하시겠습니까?`,
      confirmText: '삭제',
      danger: true,
    });
    if (!confirmed) return false;

    const toastId = showToast('휴지통으로 이동 중...', { type: 'loading', duration: 0 });

    if (onConfirmed) {
      await onConfirmed();
    }

    for (const fid of fileIds) {
      try {
        await moveToTrashFile(fid);
      } catch (e) {
        console.error('Trash error:', e);
      }
    }
    await refreshFiles();
    await refreshFoldersAndStats();
    updateToast(toastId, { message: `${fileIds.length}개 파일을 휴지통으로 이동했습니다.`, type: 'success' });
    return true;
  };

  const handleBatchDownloadFiles = async (fileIds) => {
    if (!fileIds || fileIds.length === 0 || !activeWorkspace?.id) return;
    const archiveName = `download_files_${fileIds.length}.zip`;
    const transferId = `batch-${Date.now()}`;
    const controller = new AbortController();
    abortControllersRef.current.set(transferId, controller);

    addTransfer({
      id: transferId,
      type: 'zip_download',
      name: archiveName,
      percent: 10,
      status: 'running',
      statusText: `${fileIds.length}개 파일 압축 준비 중...`,
    });

    try {
      await batchDownloadFiles({
        workspaceId: activeWorkspace.id,
        fileIds,
        folderIds: [],
        archiveName,
        onProgress: ({ percent, status }) => {
          updateTransfer(transferId, { percent, statusText: status });
        },
        signal: controller.signal,
      });
      updateTransfer(transferId, { percent: 100, status: 'completed', statusText: 'ZIP 다운로드 완료' });
    } catch (err) {
      if (controller.signal.aborted) {
        handleCancelTransfer(transferId);
        return;
      }
      console.error('Batch download error:', err);
      updateTransfer(transferId, {
        status: 'error',
        statusText: `실패: ${err.message}`,
        retryFn: () => handleBatchDownloadFiles(fileIds),
      });
    } finally {
      abortControllersRef.current.delete(transferId);
    }
  };

  // Load Workspaces for approved user
  const loadWorkspaces = useCallback(async () => {
    if (!currentUser || (!currentUser.is_approved && !currentUser.is_admin)) return;
    try {
      const wsList = await listWorkspaces();
      setWorkspaces(wsList);
      
      const urlParams = new URLSearchParams(window.location.search);
      const urlWsId = urlParams.get('ws') || urlParams.get('workspace_id');
      const savedWsId = urlWsId || localStorage.getItem('kb_active_ws_id');
      const matched = wsList.find(w => w.id === savedWsId);
      // Every user always owns exactly one non-deletable default workspace
      // (see backend Workspace.is_default), so falling back to it — rather
      // than just wsList[0] — means a stale/deleted saved workspace id never
      // leaves the app without an active workspace to show.
      const fallback = wsList.find(w => w.is_default) || wsList[0];
      const resolved = matched || fallback || null;

      setActiveWorkspace(resolved);
      if (resolved) {
        localStorage.setItem('kb_active_ws_id', resolved.id);
        localStorage.setItem('kb_active_ws_data', JSON.stringify(resolved));
      } else {
        localStorage.removeItem('kb_active_ws_id');
        localStorage.removeItem('kb_active_ws_data');
      }
      updateUrlParams({ wsId: resolved?.id || null });
    } catch (err) {
      console.error('Error loading workspaces:', err);
    } finally {
      setIsWorkspacesLoaded(true);
    }
  }, [currentUser, updateUrlParams]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleSelectWorkspace = (ws) => {
    setActiveWorkspace(ws);
    if (ws) {
      localStorage.setItem('kb_active_ws_id', ws.id);
      localStorage.setItem('kb_active_ws_data', JSON.stringify(ws));
    }
    setActiveFolderId(null);
    setActiveFile(null);
    setActiveView('all');
    setCurrentPage(1);
    updateUrlParams({ wsId: ws?.id || null, folderId: null, view: 'all' });
  };


  // Fetch Folders and System Stats
  const refreshFoldersAndStats = useCallback(async () => {
    if (!currentUser || (!currentUser.is_approved && !currentUser.is_admin)) return;
    if (!isWorkspacesLoaded) return;
    if (!activeWorkspace?.id) {
      setFolders([]);
      setStats(null);
      return;
    }
    try {
      const wsId = activeWorkspace.id;
      const [tree, systemStats] = await Promise.all([
        getFolderTree(wsId),
        getSystemStats(wsId)
      ]);
      setFolders(tree);
      setStats(systemStats);

      // On first load after workspace loads, restore folder from URL if present
      if (!isInitialFolderRestoredRef.current) {
        isInitialFolderRestoredRef.current = true;
        const urlParams = new URLSearchParams(window.location.search);
        const urlFolderId = urlParams.get('folder');
        const urlView = urlParams.get('view');

        if (urlFolderId) {
          const found = findFolderById(tree, urlFolderId);
          if (found) {
            setActiveFolderId(urlFolderId);
            setActiveView('folder');
            updateUrlParams({ folderId: urlFolderId, view: 'folder' });
          } else {
            // Folder not found in this workspace (deleted or wrong ID) -> gracefully fallback to root view
            setActiveFolderId(null);
            setActiveView('all');
            updateUrlParams({ folderId: null, view: 'all' });
          }
        } else if (urlView && urlView !== 'folder') {
          setActiveView(urlView);
          setActiveFolderId(null);
        }
      } else {
        // On subsequent refreshes (e.g. background uploads or stats sync):
        // Only if the currently active folder was deleted from tree, fallback to root.
        // NEVER force-navigate or change user's active view while uploading.
        const currentFolderId = activeFolderIdRef.current;
        if (currentFolderId && !findFolderById(tree, currentFolderId)) {
          setActiveFolderId(null);
          setActiveView('all');
          updateUrlParams({ folderId: null, view: 'all' });
        }
      }
    } catch (err) {
      console.error('Error loading folders/stats:', err);
    }
  }, [currentUser, isWorkspacesLoaded, activeWorkspace?.id, updateUrlParams]);

  useEffect(() => {
    refreshFoldersAndStats();
  }, [refreshFoldersAndStats]);

  // Support Browser Back/Forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const urlWs = params.get('ws');
      const urlFolder = params.get('folder');
      const urlView = params.get('view');

      if (urlWs && activeWorkspace?.id !== urlWs) {
        const matched = workspaces.find(w => w.id === urlWs);
        if (matched) setActiveWorkspace(matched);
      }

      if (urlFolder) {
        setActiveFolderId(urlFolder);
        setActiveView('folder');
      } else if (urlView) {
        setActiveFolderId(null);
        setActiveView(urlView);
      } else {
        setActiveFolderId(null);
        setActiveView('all');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeWorkspace?.id, workspaces]);

  // Fetch Files for active workspace with sorting and pagination
  const refreshFilesRequestIdRef = useRef(0);
  const lastWatermarkRef = useRef(null);

  // The subset of refreshFiles' params that determine *which* files this
  // view selects (not sort/page) — shared with the watermark poll below so
  // both always agree on exactly what set of files they're checking.
  const buildFileViewParams = useCallback(() => {
    if (!activeWorkspace?.id) return null;
    const params = { workspace_id: activeWorkspace.id };
    if (activeView === 'folder' && activeFolderId) {
      params.folder_id = activeFolderId;
    } else if (activeView === 'all' || (activeView === 'folder' && !activeFolderId)) {
      params.root_only = true;
    } else if (activeView === 'notes') {
      params.file_type = 'note';
    } else if (activeView === 'favorites') {
      params.is_favorite = true;
    }
    return params;
  }, [activeWorkspace?.id, activeView, activeFolderId]);

  const refreshFiles = useCallback(async (silent = false) => {
    if (!currentUser || (!currentUser.is_approved && !currentUser.is_admin)) return;
    if (!isWorkspacesLoaded) return;
    if (!activeWorkspace?.id) {
      refreshFilesRequestIdRef.current += 1;
      setFiles([]);
      setPaginationMeta({
        total_count: 0,
        total_pages: 1,
        page: 1,
        page_size: pageSize
      });
      setIsLoading(false);
      return;
    }
    if (!silent) {
      setIsLoading(true);
    }
    // Guard against out-of-order responses: if several refreshes overlap (e.g. many
    // background uploads completing in quick succession), only the response for the
    // most recently issued request is allowed to update the visible file list, so a
    // slower/stale response can't overwrite it with an outdated (or empty) result.
    const requestId = ++refreshFilesRequestIdRef.current;
    try {
      const viewParams = buildFileViewParams();
      let params = {
        ...viewParams,
        sort_by: sortBy,
        sort_order: sortOrder,
        page: currentPage,
        page_size: pageSize,
        paged: true
      };

      const res = await listFiles(params);
      if (requestId !== refreshFilesRequestIdRef.current) return; // a newer refresh superseded this one

      if (res && res.items) {
        setFiles(res.items);
        setPaginationMeta({
          total_count: res.total_count,
          total_pages: res.total_pages,
          page: res.page,
          page_size: res.page_size
        });
      } else if (Array.isArray(res)) {
        setFiles(res);
        setPaginationMeta({
          total_count: res.length,
          total_pages: 1,
          page: 1,
          page_size: pageSize
        });
      }

      // Baseline for the watermark poll below — recorded from this same
      // "real" refresh so a manual/auto refresh always resets it.
      try {
        const wm = await getFilesWatermark(viewParams);
        if (requestId === refreshFilesRequestIdRef.current) {
          lastWatermarkRef.current = wm?.watermark ?? null;
          // This refresh just brought the view fully current, so any "new files
          // available" flag the 45s poll may have raced into setting (e.g. right
          // after the user's own create/delete/move) is now stale — clear it.
          setHasNewFilesInView(false);
        }
      } catch (e) { /* polling baseline is best-effort */ }
    } catch (err) {
      console.error('Error fetching files:', err);
    } finally {
      if (!silent && requestId === refreshFilesRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [currentUser, isWorkspacesLoaded, activeWorkspace?.id, buildFileViewParams, sortBy, sortOrder, currentPage, pageSize]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  // Lets a viewer who ISN'T themselves uploading also notice the folder
  // changed (onUploadSuccess above only fires in the tab actually doing the
  // upload). Deliberately scoped down to avoid the DB-load-under-many-
  // viewers problem a naive "poll everyone, all the time" version would
  // have: only the one folder currently being viewed, only while this tab
  // is actually visible, on a slow (45s) interval, comparing a single cheap
  // aggregate rather than refetching the list. Compares a watermark (max
  // updated_at), not just the count, so a net-zero change (one file added,
  // one removed) still gets noticed.
  useEffect(() => {
    if (hasNewFilesInView) return;
    const viewParams = buildFileViewParams();
    if (!viewParams) return;

    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const wm = await getFilesWatermark(viewParams);
        const serverWatermark = wm?.watermark ?? null;
        if (serverWatermark && serverWatermark !== lastWatermarkRef.current) {
          setHasNewFilesInView(true);
        }
      } catch (e) { /* best-effort */ }
    };
    const intervalId = setInterval(poll, 45000);
    return () => clearInterval(intervalId);
  }, [hasNewFilesInView, buildFileViewParams]);

  // Global Keyboard Shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const currentFolder = activeFolderId ? findFolderById(folders, activeFolderId) : null;
  const currentFolderPath = activeFolderId ? buildFolderPath(folders, activeFolderId) : [];
  const currentSubfolders = currentFolder ? (currentFolder.children || []) : (activeView === 'all' || activeView === 'folder' ? folders : []);

  // Folder navigation
  const handleSelectFolder = (folderId) => {
    setActiveFolderId(folderId);
    const newView = folderId ? 'folder' : 'all';
    setActiveView(newView);
    setActiveFile(null);
    setCurrentPage(1);
    updateUrlParams({ folderId, view: newView });
    if (window.innerWidth <= 768) {
      setIsSidebarCollapsed(true);
    }
  };

  const handleSelectView = (viewName) => {
    setActiveView(viewName);
    setActiveFolderId(null);
    setActiveFile(null);
    setCurrentPage(1);
    updateUrlParams({ folderId: null, view: viewName });
    if (window.innerWidth <= 768) {
      setIsSidebarCollapsed(true);
    }
  };

  const handleOpenFile = (file) => {
    if (!file) return;
    windowManager.openWindow(file);
  };

  const handleNewNote = async () => {
    try {
      const newNote = await createMarkdownNote({
        name: '제목 없는 문서',
        workspace_id: activeWorkspace?.id || null,
        folder_id: activeFolderId,
        content: '',
        tags: []
      });
      await refreshFiles();
      await refreshFoldersAndStats();
      setActiveFile(newNote);
    } catch (err) {
      await showAlert({
        title: '생성 실패',
        message: '새 문서 생성에 실패했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleSaveNote = async ({ name, content, tags }) => {
    if (!activeFile) return;
    const updated = await updateMarkdownNote(activeFile.id, {
      name,
      content,
      tags
    });
    setActiveFile(updated);
    refreshFiles();
    refreshFoldersAndStats();
  };

  const handleTrashFile = async (file, onConfirmed) => {
    const confirmed = await showConfirm({
      title: '휴지통으로 이동',
      message: `'${file.name}' 파일을 휴지통으로 이동하시겠습니까?\n휴지통에서 언제든 복구할 수 있으며 30일 후 자동 영구 삭제됩니다.`,
      type: 'danger',
      confirmText: '휴지통으로 이동',
      cancelText: '취소'
    });
    if (!confirmed) return;

    const toastId = showToast('휴지통으로 이동 중...', { type: 'loading', duration: 0 });

    if (onConfirmed) {
      await onConfirmed();
    }

    try {
      await moveToTrashFile(file.id);
      if (activeFile?.id === file.id) {
        setActiveFile(null);
      }
      refreshFiles();
      refreshFoldersAndStats();
      updateToast(toastId, { message: `'${file.name}' 파일이 휴지통으로 이동되었습니다.`, type: 'success' });
    } catch (err) {
      dismissToast(toastId);
      await showAlert({
        title: '휴지통 이동 실패',
        message: '파일을 휴지통으로 이동하지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleDeleteFile = async (fileId, onConfirmed) => {
    const targetFile = files.find(f => f.id === fileId) || activeFile;
    if (targetFile) {
      await handleTrashFile(targetFile, onConfirmed);
    } else {
      try {
        if (onConfirmed) {
          await onConfirmed();
        }
        await moveToTrashFile(fileId);
        if (activeFile?.id === fileId) {
          setActiveFile(null);
        }
        refreshFiles();
        refreshFoldersAndStats();
      } catch (err) {
        await showAlert({
          title: '삭제 실패',
          message: '파일을 삭제하지 못했습니다: ' + err.message,
          type: 'error'
        });
      }
    }
  };

  const handleTrashFolder = async (folder) => {
    const confirmed = await showConfirm({
      title: '폴더 휴지통으로 이동',
      message: `'${folder.name}' 폴더를 휴지통으로 이동하시겠습니까?\n하위 파일·폴더도 함께 이동되며, 30일 후 자동 영구 삭제됩니다.`,
      type: 'danger',
      confirmText: '휴지통으로 이동',
      cancelText: '취소'
    });
    if (!confirmed) return;

    const toastId = showToast('휴지통으로 이동 중...', { type: 'loading', duration: 0 });

    try {
      await moveToTrashFolder(folder.id);
      if (activeFolderId === folder.id) {
        setActiveFolderId(null);
        setActiveView('all');
      }
      refreshFiles();
      refreshFoldersAndStats();
      updateToast(toastId, { message: `'${folder.name}' 폴더가 휴지통으로 이동되었습니다.`, type: 'success' });
    } catch (err) {
      dismissToast(toastId);
      await showAlert({
        title: '휴지통 이동 실패',
        message: '폴더를 휴지통으로 이동하지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleRenameItem = async (id, newName, type, color) => {
    if (type === 'folder') {
      await updateFolder(id, { name: newName, color });
    } else {
      await renameFile(id, newName);
    }
    refreshFiles();
    refreshFoldersAndStats();
    if (activeFile?.id === id) {
      setActiveFile(prev => ({ ...prev, name: newName }));
    }
  };

  const handleFolderContextMenu = (e, folder) => {
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '폴더 열기',
          icon: FolderIcon,
          onClick: () => handleSelectFolder(folder.id),
        },
        {
          label: '하위 폴더 생성',
          icon: FolderPlus,
          onClick: () => {
            setNewFolderParentId(folder.id);
            setIsNewFolderOpen(true);
          },
        },
        {
          label: '새 문서 작성',
          icon: Plus,
          onClick: async () => {
            try {
              const newNote = await createMarkdownNote({
                name: '제목 없는 문서',
                workspace_id: activeWorkspace?.id || null,
                folder_id: folder.id,
                content: '',
                tags: []
              });
              await refreshFiles();
              await refreshFoldersAndStats();
              setActiveFile(newNote);
            } catch (err) {
              await showAlert({
                title: '생성 실패',
                message: '새 문서 생성에 실패했습니다: ' + err.message,
                type: 'error'
              });
            }
          },
        },
        {
          label: '폴더를 ZIP으로 다운로드',
          icon: FileArchive,
          onClick: () => startDownloadFolder(folder),
        },
        { divider: true },
        {
          label: '이름 및 색상 변경',
          icon: Edit3,
          onClick: () => setRenameModal({ isOpen: true, item: { id: folder.id, name: folder.name, color: folder.color, type: 'folder' } }),
        },
        {
          label: '휴지통으로 이동',
          icon: Trash2,
          danger: true,
          onClick: () => handleTrashFolder(folder),
        },
      ]
    });
  };

  const handleFileContextMenu = (e, file) => {
    const isMedia = file.file_type === 'image' || file.file_type === 'video' || file.file_type === 'pdf';
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: isMedia ? '미디어 미리보기' : '문서 열기',
          icon: Eye,
          onClick: () => {
            if (isMedia) {
              setMediaPreviewFile(file);
            } else {
              handleOpenFile(file);
            }
          },
        },
        {
          label: file.is_favorite ? '즐겨찾기 해제' : '즐겨찾기 등록',
          icon: Star,
          onClick: () => handleToggleFavorite(file),
        },
        {
          label: '다운로드',
          icon: Download,
          onClick: () => startDownloadFile(file),
        },
        {
          label: '다른 폴더로 이동',
          icon: FolderInput,
          onClick: () => handleOpenMoveModal([file.id]),
        },
        { divider: true },
        {
          label: '이름 변경',
          icon: Edit3,
          onClick: () => setRenameModal({ isOpen: true, item: { id: file.id, name: file.name, type: 'file' } }),
        },
        {
          label: '휴지통으로 이동',
          icon: Trash2,
          danger: true,
          onClick: () => handleTrashFile(file),
        },
      ]
    });
  };

  const handleBackgroundContextMenu = (e) => {
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '새 문서 작성',
          icon: Plus,
          onClick: handleNewNote,
        },
        {
          label: '새 폴더 생성',
          icon: FolderPlus,
          onClick: () => {
            setNewFolderParentId(activeFolderId);
            setIsNewFolderOpen(true);
          },
        },
        {
          label: '파일 업로드',
          icon: UploadCloud,
          onClick: () => setIsUploadOpen(true),
        },
        { divider: true },
        {
          label: '새로고침',
          icon: RefreshCw,
          onClick: () => {
            refreshFiles();
            refreshFoldersAndStats();
          },
        },
      ]
    });
  };

  const handleToggleFavorite = async (file) => {
    try {
      await updateMarkdownNote(file.id, { is_favorite: !file.is_favorite });
      refreshFiles();
      if (activeFile?.id === file.id) {
        setActiveFile(prev => ({ ...prev, is_favorite: !prev.is_favorite }));
      }
    } catch (err) {
      console.error('Favorite toggle error:', err);
    }
  };

  const handleCreateFolder = async ({ name, parent_id, color }) => {
    await createFolder({ 
      name, 
      parent_id, 
      workspace_id: activeWorkspace?.id || null, 
      color 
    });
    refreshFoldersAndStats();
  };

  const handleDropFiles = (droppedFiles) => {
    if (droppedFiles && droppedFiles.length > 0) {
      uploadManager.checkAndQueueFiles(droppedFiles, activeFolderId, activeWorkspace?.id);
      setIsUploadOpen(true);
    }
  };

  const handleLogout = () => {
    logout();
    setCurrentUser(null);
  };

  // 1. Loading state
  if (isAuthLoading) {
    return (
      <ThemeProvider theme={theme}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
          인증 상태를 확인하고 있습니다...
        </div>
      </ThemeProvider>
    );
  }

  // 2. Not logged in -> Show Login
  if (!currentUser) {
    return (
      <ThemeProvider theme={theme}>
        <LoginModal
          isOpen={true}
          onLoginSuccess={(user) => {
            setCurrentUser(user);
          }}
        />
      </ThemeProvider>
    );
  }

  // 3. Logged in but not approved and not admin -> Show Pending Approval
  if (!currentUser.is_approved && !currentUser.is_admin) {
    return (
      <ThemeProvider theme={theme}>
        <PendingApprovalScreen
          user={currentUser}
          onApproved={(user) => setCurrentUser(user)}
          onLogout={handleLogout}
        />
      </ThemeProvider>
    );
  }

  // 4. Admin Dashboard View
  if (activeView === 'admin') {
    return (
      <ThemeProvider theme={theme}>
        <AdminDashboard
          currentUser={currentUser}
          onBackToApp={() => setActiveView('all')}
        />
      </ThemeProvider>
    );
  }

  // 5. Main Knowledge Base App
  return (
    <ThemeProvider theme={theme}>
    <div className="app-container">
      {/* Mobile Drawer Backdrop */}
      {!isSidebarCollapsed && (
        <div 
          className="mobile-sidebar-backdrop" 
          onClick={() => setIsSidebarCollapsed(true)} 
        />
      )}

      <Sidebar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        isWorkspacesLoaded={isWorkspacesLoaded}
        onSelectWorkspace={handleSelectWorkspace}
        onOpenCreateWorkspace={() => {
          setIsCreateWorkspaceMode(true);
          setIsWorkspaceModalOpen(true);
        }}
        onOpenWorkspaceSettings={() => {
          setIsCreateWorkspaceMode(false);
          setIsWorkspaceModalOpen(true);
        }}
        folders={folders}
        activeFolderId={activeFolderId}
        onSelectFolder={handleSelectFolder}
        activeView={activeView}
        onSelectView={handleSelectView}
        onNewNote={handleNewNote}
        onNewFolder={(parentId) => {
          setNewFolderParentId(parentId !== undefined ? parentId : activeFolderId);
          setIsNewFolderOpen(true);
        }}
        onOpenUpload={() => setIsUploadOpen(true)}
        onFolderContextMenu={handleFolderContextMenu}
        stats={stats}
        isCollapsed={isSidebarCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed(true)}
      />

      <div className="main-content">
        <TopBar
          currentUser={currentUser}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(false)}
          onOpenSearch={() => setIsSearchOpen(true)}
          onNewNote={handleNewNote}
          onOpenUpload={() => setIsUploadOpen(true)}
          onOpenInvitations={() => setIsInvitationModalOpen(true)}
          currentFolder={currentFolder}
          currentFile={activeFile}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSetTheme={handleSetTheme}
          onNavigateHome={() => {
            setActiveFolderId(null);
            setActiveView('all');
            setActiveFile(null);
          }}
          onOpenAdmin={() => setActiveView('admin')}
          onLogout={handleLogout}
        />

        {activeView === 'trash' ? (
          <TrashExplorer
            activeWorkspace={activeWorkspace}
            currentUser={currentUser}
            onOpenMediaPreview={(file) => windowManager.openWindow(file)}
            onRefreshParent={() => {
              refreshFiles();
              refreshFoldersAndStats();
            }}
          />
        ) : activeFile ? (
          <NoteEditor
            file={activeFile}
            activeWorkspaceId={activeWorkspace?.id}
            currentUser={currentUser}
            onSave={handleSaveNote}
            onBack={() => setActiveFile(null)}
            onDelete={handleDeleteFile}
            onToggleFavorite={handleToggleFavorite}
          />
        ) : (
          <FolderExplorer
            workspaceName={activeWorkspace?.name || ''}
            theme={theme}
            isLoading={isLoading || !isWorkspacesLoaded || isAuthLoading}
            activeView={activeView}
            onSelectView={handleSelectView}
            currentFolder={currentFolder}
            subfolders={currentSubfolders}
            files={files}
            folderPath={currentFolderPath}
            onSelectFolder={handleSelectFolder}
            onOpenFile={handleOpenFile}
            onOpenMediaPreview={(file) => windowManager.openWindow(file)}
            onNewNote={handleNewNote}
            onNewFolder={(parentId) => {
              setNewFolderParentId(parentId !== undefined ? parentId : activeFolderId);
              setIsNewFolderOpen(true);
            }}
            onOpenUpload={() => setIsUploadOpen(true)}
            onDeleteFile={handleDeleteFile}
            onToggleFavorite={handleToggleFavorite}
            onDropFiles={handleDropFiles}
            onFolderContextMenu={handleFolderContextMenu}
            onFileContextMenu={handleFileContextMenu}
            onBackgroundContextMenu={handleBackgroundContextMenu}
            onDownloadFolder={startDownloadFolder}
            onDownloadFile={startDownloadFile}
            onOpenMoveModal={handleOpenMoveModal}
            onBatchDownload={handleBatchDownloadFiles}
            onBatchDelete={handleBatchTrashFiles}
            onDirectMoveFiles={handleDirectMoveFiles}
            hasOpenWindows={windowManager.windows.length > 0}
            hasNewFiles={hasNewFilesInView}
            onRefreshNewFiles={() => {
              setHasNewFilesInView(false);
              refreshFiles(true);
            }}
            sortBy={sortBy}
            onSortByChange={(newSort) => {
              setSortBy(newSort);
              setCurrentPage(1);
            }}
            sortOrder={sortOrder}
            onToggleSortOrder={() => {
              setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
              setCurrentPage(1);
            }}
            currentPage={currentPage}
            onPageChange={(page) => setCurrentPage(page)}
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
            paginationMeta={paginationMeta}
            uploadManager={uploadManager}
          />
        )}
      </div>

      {/* Modals */}
      <SemanticSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        activeWorkspaceId={activeWorkspace?.id || null}
        folders={folders}
        onSelectResult={(item) => {
          handleOpenFile({ id: item.file_id });
        }}
      />

      <ChunkedUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        activeWorkspaceId={activeWorkspace?.id || null}
        currentFolderId={activeFolderId}
        folders={folders}
        uploadManager={uploadManager}
      />

      <FileConflictModal
        isOpen={!!uploadManager.pendingConflict}
        conflicts={uploadManager.pendingConflict?.conflicts || []}
        onCancel={uploadManager.cancelFileConflict}
        onConfirm={uploadManager.resolveFileConflicts}
      />

      {/* Persistent Upload Progress Floating Banner */}
      {!isUploadOpen && (
        <UploadProgressBanner
          uploadManager={uploadManager}
          onOpenModal={() => setIsUploadOpen(true)}
        />
      )}

      <NewFolderModal
        isOpen={isNewFolderOpen}
        onClose={() => setIsNewFolderOpen(false)}
        parentFolderId={newFolderParentId}
        folders={folders}
        onCreate={handleCreateFolder}
      />

      <WorkspaceSettingsModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
        isCreateMode={isCreateWorkspaceMode}
        workspace={activeWorkspace}
        currentUser={currentUser}
        onWorkspaceCreated={(newWs) => {
          loadWorkspaces();
          handleSelectWorkspace(newWs);
        }}
        onWorkspaceUpdated={(updatedWs) => {
          loadWorkspaces();
          setActiveWorkspace(updatedWs);
        }}
        onWorkspaceDeleted={(deletedId) => {
          loadWorkspaces();
        }}
      />

      {/* OS-Style Multi-Window Preview Manager & Dock */}
      <WindowManager
        windowManager={windowManager}
        onEditFile={(file) => {
          setActiveFile(file);
        }}
      />

      {/* Invitation Manager Modal (7-day invites & AWS SES) */}
      <InvitationManagerModal
        isOpen={isInvitationModalOpen}
        onClose={() => setIsInvitationModalOpen(false)}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspace?.id}
        currentUser={currentUser}
      />

      {/* Context Menu */}
      {contextMenu.isOpen && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu({ isOpen: false, x: 0, y: 0, items: [] })}
        />
      )}

      {/* Rename Modal */}
      <RenameModal
        isOpen={renameModal.isOpen}
        item={renameModal.item}
        onClose={() => setRenameModal({ isOpen: false, item: null })}
        onRename={handleRenameItem}
      />

      {/* Move Files Modal */}
      <MoveFilesModal
        isOpen={moveFilesModal.isOpen}
        fileIds={moveFilesModal.fileIds}
        folders={folders}
        currentFolderId={activeFolderId}
        onClose={() => setMoveFilesModal({ isOpen: false, fileIds: [] })}
        onConfirmMove={handleConfirmMoveFiles}
      />

      {/* Google Drive-style Resilient Transfer Manager */}
      <TransferManager
        transfers={transfers}
        onRetry={handleRetryTransfer}
        onCancel={handleCancelTransfer}
        onClearCompleted={handleClearCompletedTransfers}
      />
    </div>
    </ThemeProvider>
  );
}
