import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import FolderExplorer from './components/explorer/FolderExplorer';
import SemanticSearchModal from './components/search/SemanticSearchModal';
import ChunkedUploadModal from './components/upload/ChunkedUploadModal';
import FileConflictModal from './components/upload/FileConflictModal';
import NewFolderModal from './components/modals/NewFolderModal';
import LoginModal from './components/auth/LoginModal';
import PendingApprovalScreen from './components/auth/PendingApprovalScreen';
import ChooseHandleScreen from './components/auth/ChooseHandleScreen';
import AdminDashboard from './components/admin/AdminDashboard';
import WorkspaceSettingsModal from './components/workspace/WorkspaceSettingsModal';
import MediaPreviewModal from './components/modals/MediaPreviewModal';
import InvitationManagerModal from './components/admin/InvitationManagerModal';
import TrashExplorer from './components/trash/TrashExplorer';
import ReportsExplorer from './components/admin/ReportsExplorer';
import ScheduleExplorer from './components/board/ScheduleExplorer';
import ReportModal from './components/modals/ReportModal';
import FolderShareModal from './components/modals/FolderShareModal';
import ContextMenu from './components/common/ContextMenu';
import RenameModal from './components/modals/RenameModal';
import MoveFilesModal from './components/modals/MoveFilesModal';
import TransferManager from './components/transfer/TransferManager';
import CopyJobsBanner from './components/transfer/CopyJobsBanner';
import WindowManager from './components/window/WindowManager';
import { useWindowManager } from './hooks/useWindowManager';
import UploadProgressBanner from './components/upload/UploadProgressBanner';
import { useUploadManager } from './hooks/useUploadManager';
import { 
  Folder as FolderIcon,
  FolderPlus,
  CalendarCheck,
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
  FolderInput,
  ExternalLink,
  Flag,
  Users,
  Scissors,
  Copy,
  ClipboardPaste
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
  listFavoriteIds,
  setFavorite,
  createBoard,
  deleteFolder,
  updateFolder,
  getSystemStats,
  uploadFileChunked,
  moveToTrashFile,
  getFilesAttachedTo,
  restoreFile,
  moveToTrashFolder,
  restoreFolder,
  renameFolder,
  renameFile,
  getFileDownloadUrl,
  downloadFileChunked,
  downloadFolderAsZip,
  batchDownloadFiles,
  batchMoveFiles,
  batchMoveFolders,
  batchCopyItems,
  listFileIds,
  getPendingReportCount
} from './api';
import { useDialog } from './context/DialogContext';
import { useToast } from './context/ToastContext';

// Sort/pagination defaults — also the fallback whenever a URL carries a
// value outside these sets (hand-edited link, stale bookmark from an older
// build, a truncated share). An unrecognised value is never passed through
// to the API; the view silently falls back to newest-first, page 1.
const SORT_BY_VALUES = ['name', 'file_type', 'updated_at', 'created_at', 'size_bytes'];
const SORT_ORDER_VALUES = ['asc', 'desc'];
const PAGE_SIZE_VALUES = [10, 20, 50, 100];
const DEFAULT_SORT_BY = 'updated_at';
const DEFAULT_SORT_ORDER = 'desc';
const DEFAULT_PAGE_SIZE = 20;

function readUrlParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (e) {
    return null;
  }
}

function readSortByFromUrl() {
  const v = readUrlParam('sort');
  return SORT_BY_VALUES.includes(v) ? v : DEFAULT_SORT_BY;
}

function readSortOrderFromUrl() {
  const v = readUrlParam('order');
  return SORT_ORDER_VALUES.includes(v) ? v : DEFAULT_SORT_ORDER;
}

function readPageSizeFromUrl() {
  const v = Number(readUrlParam('size'));
  return PAGE_SIZE_VALUES.includes(v) ? v : DEFAULT_PAGE_SIZE;
}

function readPageFromUrl() {
  // Only a positive integer is meaningful. A page beyond the last one can't
  // be validated here (the total isn't known until the list loads) — the
  // clamp for that lives with paginationMeta instead.
  const raw = readUrlParam('page');
  if (raw === null || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

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
  // Two themes, so there is nothing to choose between them and the browser:
  // until someone picks one, each load reads the browser's setting; after
  // that, their pick is what is stored and what is used.
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('kb_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
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

  const updateUrlParams = useCallback(({ wsId, folderId, view, sortBy, sortOrder, page, pageSize }) => {
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
      // Sort/pagination params are omitted from the URL whenever they equal
      // the default, so an untouched view keeps the clean URL it has today
      // and only a deliberately changed sort/page shows up.
      if (sortBy !== undefined) {
        if (sortBy && sortBy !== DEFAULT_SORT_BY) url.searchParams.set('sort', sortBy);
        else url.searchParams.delete('sort');
      }
      if (sortOrder !== undefined) {
        if (sortOrder && sortOrder !== DEFAULT_SORT_ORDER) url.searchParams.set('order', sortOrder);
        else url.searchParams.delete('order');
      }
      if (page !== undefined) {
        if (page && page > 1) url.searchParams.set('page', String(page));
        else url.searchParams.delete('page');
      }
      if (pageSize !== undefined) {
        if (pageSize && pageSize !== DEFAULT_PAGE_SIZE) url.searchParams.set('size', String(pageSize));
        else url.searchParams.delete('size');
      }
      window.history.replaceState(null, '', url.toString());
    } catch (e) {}
  }, []);

  // Navigation & View (Initialize from URL query params)
  const [folders, setFolders] = useState([]);
  // True only while the folder tree/stats being shown belong to a DIFFERENT
  // workspace than activeWorkspace — i.e. an actual workspace switch, not
  // every routine refresh (a background upload completing shouldn't flash
  // this). Lets the sidebar hide the stale previous workspace's folders/
  // counts instead of showing them until the new data happens to arrive.
  const [isFoldersLoading, setIsFoldersLoading] = useState(false);
  const loadedFoldersWorkspaceIdRef = useRef(null);
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
  const refreshFoldersRequestIdRef = useRef(0);

  useEffect(() => {
    activeFolderIdRef.current = activeFolderId;
  }, [activeFolderId]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  // True once the viewed set's watermark (max updated_at) moves — a file was
  // added, edited, or removed in the current view. Deliberately does NOT
  // trigger an auto-refresh of the file list — with the default "최근
  // 수정일순" sort, silently refetching would keep bumping the user's current
  // page's files onto later pages as new/updated items sort to the top,
  // making files the user is looking at seem to vanish even though they
  // still exist. Surface a "새로운 변경 사항이 있습니다" prompt instead and let
  // the user choose when to refresh.
  const [hasNewFilesInView, setHasNewFilesInView] = useState(false);

  const [files, setFiles] = useState([]);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Sorting & Pagination State — restored from the URL so a refresh (or a
  // shared/bookmarked link) lands on the same sort and page instead of
  // snapping back to newest-first page 1. Anything unrecognised in the URL
  // falls back to the defaults; see the read*FromUrl helpers above.
  const [sortBy, setSortBy] = useState(readSortByFromUrl); // 'name' | 'file_type' | 'updated_at' | 'created_at' | 'size_bytes'
  const [sortOrder, setSortOrder] = useState(readSortOrderFromUrl); // 'asc' | 'desc'
  const [currentPage, setCurrentPage] = useState(readPageFromUrl);
  const [pageSize, setPageSize] = useState(readPageSizeFromUrl);
  const [paginationMeta, setPaginationMeta] = useState({
    total_count: 0,
    // null = "no server response yet", distinct from a real result that
    // genuinely has one page. The out-of-range page clamp below must not
    // fire against this placeholder: on a reload of, say, ?page=3 it would
    // see total_pages 1 and reset to page 1 before the first response ever
    // arrived, silently undoing the page the URL asked to restore.
    total_pages: null,
    page: 1,
    page_size: DEFAULT_PAGE_SIZE
  });

  // Modals & Popups
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState(null);
  const [isInvitationModalOpen, setIsInvitationModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState({ isOpen: false, x: 0, y: 0, items: [] });
  // Kept in sessionStorage so a reload doesn't silently drop a pending
  // 잘라내기 — the cut items would still be sitting there looking normal with
  // nothing left to paste. Per-tab rather than shared: two tabs holding
  // different cut selections must not overwrite each other.
  const [clipboard, setClipboard] = useState(() => {
    try {
      const raw = sessionStorage.getItem('kb_explorer_clipboard');
      const v = raw ? JSON.parse(raw) : null;
      // Anything not matching the expected shape is ignored rather than
      // trusted — a half-written or older-format entry would otherwise reach
      // the paste handlers as undefined arrays.
      if (v && (v.mode === 'cut' || v.mode === 'copy') && Array.isArray(v.fileIds) && Array.isArray(v.folderIds)) return v;
    } catch (e) {}
    return null;
  });

  useEffect(() => {
    try {
      if (clipboard) sessionStorage.setItem('kb_explorer_clipboard', JSON.stringify(clipboard));
      else sessionStorage.removeItem('kb_explorer_clipboard');
    } catch (e) {}
  }, [clipboard]);
  const [renameModal, setRenameModal] = useState({ isOpen: false, item: null });

  // OS-Style Multi-Window Manager
  // Taskbar state is persisted per user, so it survives a reload and
  // follows them to another browser. Gated on a known user: before login
  // there is nothing to restore and no one to save for.
  const windowManager = useWindowManager({
    enabled: !!currentUser?.id,
    currentUserId: currentUser?.id || null,
  });

  const refreshDebounceTimerRef = useRef(null);

  // Persistent Upload Manager
  // Where this batch of uploads is landing, collected as they complete so the
  // refresh at the end knows which views actually changed.
  const uploadTargetsRef = useRef(new Set());

  const uploadManager = useUploadManager({
    onUploadSuccess: (completedItem) => {
      uploadTargetsRef.current.add(
        `${completedItem?.activeWorkspaceId || 'none'}:${completedItem?.targetFolderId || 'root'}`
      );
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

  // Applying it is all this does. Storing happens where the choice is made,
  // so someone who has never picked keeps following their browser on the next
  // load rather than being pinned to whatever it said the first time.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }, [theme]);

  const chooseTheme = (next) => {
    const picked = next === 'light' ? 'light' : 'dark';
    localStorage.setItem('kb_theme', picked);
    setTheme(picked);
  };

  const toggleTheme = () => chooseTheme(theme === 'dark' ? 'light' : 'dark');

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
      bumpWindowRefresh();
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
      bumpWindowRefresh();
      showToast(`${res.moved_count}개의 파일이 이동되었습니다.`, { type: 'success' });
    } catch (err) {
      await showAlert({
        title: '이동 실패',
        message: '파일 이동 중 오류가 발생했습니다: ' + err.message,
        type: 'error',
      });
    }
  };

  // Drag-and-drop move for a mixed selection of files and folders, from any
  // drop target (folder card, sidebar tree row, breadcrumb, 상위 폴더 button).
  // Folders move one PUT each — there is no batch endpoint for them, and a
  // drag realistically carries one or a handful, not thousands like a file
  // multi-select can.
  const handleDirectMoveItems = async (fileIds = [], folderIds = [], targetFolderId = null, { announce = true, undoable = true, sourceFolderId = undefined } = {}) => {
    if (!activeWorkspace?.id) return;
    if (!fileIds.length && !folderIds.length) return;

    // Dropping something back where it already is is not a move. Treating it
    // as one wrote a history entry, announced a move that never happened, and
    // — because it still refreshed — made a drag that ended on its own row
    // look like it had done something.
    const target = targetFolderId ?? null;
    const alreadyThere = (id, kind) => {
      if (kind === 'file') {
        const file = files.find((f) => f.id === id);
        return file ? (file.folder_id ?? null) === target : false;
      }
      const node = findFolderById(folders, id);
      return node ? (node.parent_id ?? null) === target : false;
    };
    const movingFiles = fileIds.filter((id) => !alreadyThere(id, 'file'));
    const movingFolders = folderIds.filter((id) => !alreadyThere(id, 'folder'));
    if (!movingFiles.length && !movingFolders.length) return;
    fileIds = movingFiles;
    folderIds = movingFolders;

    // Where each item is right now, captured before the move. A multi-select
    // drag can pull items out of several different folders, so "put it back"
    // has to mean the folder each one actually came from — a single origin
    // would scatter them somewhere they never were.
    // `files` only holds what the main explorer is showing, so a file dragged
    // or cut out of a folder window is not in it — those moves recorded no
    // origin at all and "되돌리기" put nothing back while reporting success.
    // The drag and the clipboard both carry where they came from for exactly
    // this; a single drag comes from a single folder.
    const originById = new Map();
    files.forEach((f) => { if (fileIds.includes(f.id)) originById.set(f.id, f.folder_id ?? null); });
    if (sourceFolderId !== undefined) {
      fileIds.forEach((fid) => { if (!originById.has(fid)) originById.set(fid, sourceFolderId ?? null); });
    }
    const folderOrigins = folderIds.map((id) => {
      const node = findFolderById(folders, id);
      return { id, parentId: node ? (node.parent_id ?? null) : (sourceFolderId ?? null) };
    });

    try {
      // Folders first, and in one request. The destination has a ceiling on
      // how many folders it may hold, so this is the part that can be refused
      // — and it has to be refused before any file has moved, or a selection
      // of both would end up half-arrived. The server accepts all or none.
      if (folderIds.length) {
        await batchMoveFolders(activeWorkspace.id, folderIds, targetFolderId);
      }
      let movedFiles = 0;
      if (fileIds.length) {
        const res = await batchMoveFiles(activeWorkspace.id, fileIds, targetFolderId);
        movedFiles = res.moved_count ?? fileIds.length;
      }

      await refreshFiles();
      await refreshFoldersAndStats();
      bumpWindowRefresh();

      const parts = [];
      if (movedFiles) parts.push(`파일 ${movedFiles}개`);
      if (folderIds.length) parts.push(`폴더 ${folderIds.length}개`);
      if (announce) showToast(`${parts.join(', ')}를 이동했습니다.`, { type: 'success' });

      if (undoable) {
        const wsId = activeWorkspace.id;
        pushUndo({
          label: '이동',
          undo: async () => {
            // Grouped by origin so each item returns to the folder it left,
            // and issued as one request per origin rather than per file.
            const byOrigin = new Map();
            originById.forEach((origin, fileId) => {
              const key = origin ?? '__root__';
              if (!byOrigin.has(key)) byOrigin.set(key, { origin, ids: [] });
              byOrigin.get(key).ids.push(fileId);
            });
            for (const { origin, ids } of byOrigin.values()) {
              await batchMoveFiles(wsId, ids, origin);
            }
            // Grouped the same way, and as one request per origin — an undo
            // that only partly lands is the very thing being undone.
            const foldersByOrigin = new Map();
            folderOrigins.forEach(({ id, parentId }) => {
              const key = parentId ?? '__root__';
              if (!foldersByOrigin.has(key)) foldersByOrigin.set(key, { parentId, ids: [] });
              foldersByOrigin.get(key).ids.push(id);
            });
            for (const { parentId, ids } of foldersByOrigin.values()) {
              await batchMoveFolders(wsId, ids, parentId);
            }
          },
        });
      }

      return { movedFiles, movedFolders: folderIds.length };
    } catch (err) {
      // The server explains a refusal in the sentence a person should read —
      // how full the destination is, and that nothing was moved. Prefixing it
      // with a generic line only buries that.
      await showAlert({
        title: '이동하지 않았습니다',
        message: err.message || '이동 중 오류가 발생했습니다.',
        type: 'error',
      });
      // Files and folders move in separate requests, so one can land while
      // the other is refused — resync rather than trusting the local view.
      await refreshFiles();
      await refreshFoldersAndStats();
      bumpWindowRefresh();
    }
  };

  // Bumped whenever something changes on disk, so every open folder window
  // reloads its listing. A window showing a folder someone else's drop just
  // changed would otherwise keep displaying the old contents.
  // A favourite belongs to the person, not to the folder — two people sharing
  // a workspace keep different shortcut lists, which matters most in the
  // shared workspace where everyone sees the same space.
  const [favoriteFolderIds, setFavoriteFolderIds] = useState(() => new Set());
  const [favoriteRefreshToken, setFavoriteRefreshToken] = useState(0);

  const [windowRefreshToken, setWindowRefreshToken] = useState({ n: 0, keys: null });
  const [queuedJobCount, setQueuedJobCount] = useState(0);
  const [reportFile, setReportFile] = useState(null);
  const [shareFolder, setShareFolder] = useState(null);
  const [uploaderFilter, setUploaderFilter] = useState(null);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  // Bumped whenever a board changes, so the 일정 tab reflects it without the
  // user having to ask — the same rule the rest of the app follows.
  const [scheduleRefreshToken, setScheduleRefreshToken] = useState(0);

  // The badge is what tells an administrator there is anything to look at, so
  // it is refreshed on a slow interval rather than only on page load.
  const refreshFavoriteFolders = useCallback(async () => {
    if (!currentUser) { setFavoriteFolderIds(new Set()); return; }
    try {
      const res = await listFavoriteIds('folder');
      setFavoriteFolderIds(new Set(res.ids || []));
    } catch (e) { /* the stars just stay as they were */ }
  }, [currentUser]);

  useEffect(() => { refreshFavoriteFolders(); }, [refreshFavoriteFolders]);

  // The queue carries a summary of the file, not the file record itself — the
  // window needs the real one, and opening it with the summary left a window
  // that appeared and then vanished when the state sync re-read it by id.
  const handleOpenReportedFile = useCallback(async (summary) => {
    if (!summary?.id) return;
    try {
      const full = await getFileDetail(summary.id);
      windowManager.openWindow(full);
    } catch (err) {
      showToast(err.message || '파일을 열지 못했습니다. 이미 삭제되었을 수 있습니다.', { type: 'error' });
    }
  }, [windowManager, showToast]);

  const handleToggleFolderFavorite = useCallback(async (folder) => {
    const on = !favoriteFolderIds.has(folder.id);
    // Flipped first: the star is a direct response to a click, and waiting a
    // round trip to fill it in reads as the click not registering.
    setFavoriteFolderIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(folder.id); else next.delete(folder.id);
      return next;
    });
    try {
      await setFavorite('folder', folder.id, on);
      setFavoriteRefreshToken((n) => n + 1);
    } catch (err) {
      setFavoriteFolderIds((prev) => {
        const next = new Set(prev);
        if (on) next.delete(folder.id); else next.add(folder.id);
        return next;
      });
      showToast(err.message, { type: 'error' });
    }
  }, [favoriteFolderIds]);

  const refreshReportCount = useCallback(async () => {
    if (!currentUser?.is_superadmin || !activeWorkspace?.is_shared) { setPendingReportCount(0); return; }
    try {
      const res = await getPendingReportCount();
      setPendingReportCount(res.pending || 0);
    } catch (e) { /* best-effort */ }
  }, [currentUser?.is_superadmin, activeWorkspace?.is_shared]);

  useEffect(() => {
    refreshReportCount();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshReportCount();
    }, 60000);
    return () => clearInterval(id);
  }, [refreshReportCount]);
  // `keys` narrows the refresh to particular locations, as
  // `${workspaceId}:${folderId|root}`. Omitted means every open window, which
  // is right for a move or a delete — those change two places at once. An
  // upload only changes where it landed, and refetching a window showing
  // something else is work nobody asked for.
  const bumpWindowRefresh = useCallback((keys = null) => {
    setWindowRefreshToken((n) => ({ n: (typeof n === 'object' ? n.n : n) + 1, keys }));
  }, []);



  /**
   * The one path every move/copy goes through, wherever it was started —
   * a drag onto a folder, a paste, a folder window, the sidebar.
   *
   * Within one workspace a move is a rename: the row changes parent and
   * nothing is duplicated. Across workspaces it cannot be, any more than
   * dragging between two drives can — the item is copied into the
   * destination, and a move additionally sends the originals to the source
   * workspace's trash. They go to the trash rather than being deleted so a
   * mistaken transfer is recoverable; the cost is that the source workspace
   * keeps counting those bytes until its trash is emptied, exactly as a
   * recycle bin does.
   */
  const handleTransferItems = async ({
    fileIds = [],
    folderIds = [],
    sourceWorkspaceId = null,
    sourceFolderId = undefined,
    targetWorkspaceId = null,
    targetFolderId = null,
    mode = 'move',
  }) => {
    if (!fileIds.length && !folderIds.length) return;
    const sameWorkspace = !sourceWorkspaceId || !targetWorkspaceId || sourceWorkspaceId === targetWorkspaceId;

    if (sameWorkspace && mode === 'move') {
      await handleDirectMoveItems(fileIds, folderIds, targetFolderId, { sourceFolderId });
      bumpWindowRefresh();
      return;
    }

    try {
      const res = await batchCopyItems(targetWorkspaceId, fileIds, folderIds, targetFolderId, {
        sourceWorkspaceId,
        trashSource: mode === 'move',
      });

      if (!res.job_id) {
        showToast('옮길 항목이 없습니다.', { type: 'info' });
        return;
      }
      // The server does the copying, so this only reports that the work was
      // accepted; the background banner follows it from here and refreshes
      // the views when it lands — including if the browser was closed and
      // reopened in between.
      setQueuedJobCount((n) => n + 1);
      const notes = res.skipped_cycles ? ` (폴더 ${res.skipped_cycles}개는 자기 자신 안으로 넣을 수 없어 제외)` : '';
      showToast(
        `${mode === 'move' ? '이동' : '복사'} 작업을 예약했습니다. 파일 ${res.total_files}개를 백그라운드에서 처리합니다.${notes}`,
        { type: 'info' }
      );
    } catch (err) {
      await showAlert({
        title: mode === 'move' ? '이동 실패' : '복사 실패',
        message: err.message,
        type: 'error',
      });
    }
  };

  // Explorer clipboard for cut/copy/paste, modelled on Windows Explorer: it
  // holds ids rather than content, survives navigating between folders (that
  // is the whole point — you cut here and paste there), and is scoped to one
  // workspace because neither move nor copy crosses a workspace boundary.
  const clipboardHasItems = !!clipboard && (clipboard.fileIds.length > 0 || clipboard.folderIds.length > 0);

  const handleClipboardCut = (fileIds = [], folderIds = [], workspaceId = undefined, sourceFolderId = undefined) => {
    if (!fileIds.length && !folderIds.length) return;
    // Where it was cut from, for the same reason the drag payload carries it:
    // a cut made in a folder window is invisible to the main file list, so
    // undo would have nothing to put back.
    setClipboard({
      mode: 'cut',
      workspaceId: workspaceId ?? activeWorkspace?.id ?? null,
      sourceFolderId: sourceFolderId ?? activeFolderId ?? null,
      fileIds,
      folderIds,
    });
    showToast(`${fileIds.length + folderIds.length}개 항목을 잘라냈습니다. 붙여넣을 위치에서 Ctrl+V를 누르세요.`, { type: 'info' });
  };

  const handleClipboardCopy = (fileIds = [], folderIds = [], workspaceId = undefined) => {
    if (!fileIds.length && !folderIds.length) return;
    setClipboard({ mode: 'copy', workspaceId: workspaceId ?? activeWorkspace?.id ?? null, fileIds, folderIds });
    showToast(`${fileIds.length + folderIds.length}개 항목을 복사했습니다. 붙여넣을 위치에서 Ctrl+V를 누르세요.`, { type: 'info' });
  };

  const handleClipboardPaste = async (targetFolderId = activeFolderId, targetWorkspaceId = undefined, onDone = null) => {
    if (!clipboardHasItems) return;
    const destWorkspaceId = targetWorkspaceId ?? activeWorkspace?.id ?? null;
    const { mode, fileIds, folderIds } = clipboard;
    const crossWorkspace = !!destWorkspaceId && clipboard.workspaceId !== destWorkspaceId;

    // Crossing workspaces is a transfer between separate storage domains, so
    // it can only ever duplicate — even a 잘라내기, which then sends the
    // originals to the source's trash rather than deleting them, so a mistaken
    // move stays recoverable. Same-workspace paste keeps its cheap rename-only
    // move below.
    if (crossWorkspace) {
      await handleTransferItems({
        fileIds,
        folderIds,
        sourceWorkspaceId: clipboard.workspaceId,
        sourceFolderId: clipboard.sourceFolderId,
        targetWorkspaceId: destWorkspaceId,
        targetFolderId,
        mode: mode === 'cut' ? 'move' : 'copy',
      });
      if (mode === 'cut') setClipboard(null);
      onDone?.();
      return;
    }

    // Pasting a folder copies its whole subtree, so this can run for a while
    // with nothing on screen to say so. The toast stays up for the duration
    // and is replaced by the result, matching how batch delete already
    // reports itself.
    const count = fileIds.length + folderIds.length;
    const toastId = showToast(
      mode === 'cut' ? `${count}개 항목을 이동하는 중...` : `${count}개 항목을 붙여넣는 중...`,
      { type: 'loading', duration: 0 }
    );

    try {
      if (mode === 'cut') {
        // A move is exactly what drag-and-drop already does, down to the
        // folder cycle guard the server applies, so paste reuses it rather
        // than growing a second path that could drift from it.
        const moved = await handleDirectMoveItems(fileIds, folderIds, targetFolderId, {
          announce: false,
          sourceFolderId: clipboard.sourceFolderId,
        });
        setClipboard(null);  // cut is consumed by its paste, as in Explorer
        bumpWindowRefresh();
        onDone?.();
        const moveParts = [];
        if (moved?.movedFiles) moveParts.push(`파일 ${moved.movedFiles}개`);
        if (moved?.movedFolders) moveParts.push(`폴더 ${moved.movedFolders}개`);
        updateToast(toastId, {
          message: moveParts.length ? `${moveParts.join(', ')}를 이동했습니다.` : '이동할 항목이 없습니다.',
          type: moveParts.length ? 'success' : 'info',
        });
        return;
      }

      const res = await batchCopyItems(activeWorkspace.id, fileIds, folderIds, targetFolderId);
      // The copy itself runs on the server and the banner reloads everything
      // when it lands, but the queued state is worth showing straight away.
      bumpWindowRefresh();
      onDone?.();

      if (!res.job_id) {
        updateToast(toastId, { message: '붙여넣을 항목이 없습니다.', type: 'info' });
        return;
      }
      // Queued on the server: the copy keeps going if this tab is closed, and
      // the background banner reports progress and completion.
      setQueuedJobCount((n) => n + 1);
      const notes = res.skipped_cycles
        ? ` (폴더 ${res.skipped_cycles}개는 자기 자신 안으로 붙여넣을 수 없어 제외)`
        : '';
      updateToast(toastId, {
        message: `붙여넣기를 예약했습니다. 파일 ${res.total_files}개를 백그라운드에서 처리합니다.${notes}`,
        type: 'info',
      });
      // Copy stays on the clipboard so it can be pasted into several places,
      // which is how Explorer behaves and is the only reason to keep it.
    } catch (err) {
      dismissToast(toastId);
      await showAlert({ title: '붙여넣기 실패', message: err.message, type: 'error' });
    }
  };

  // Handles a mixed selection: folders became selectable alongside files, and
  // deleting only the files out of such a selection would quietly leave the
  // folders behind — worse than not offering it at all.
  const handleBatchTrashItems = async (fileIds = [], folderIds = [], onConfirmed) => {
    if (!fileIds.length && !folderIds.length) return false;

    const what = [];
    if (folderIds.length) what.push(`폴더 ${folderIds.length}개`);
    if (fileIds.length) what.push(`파일 ${fileIds.length}개`);
    const warning = await attachmentWarning(fileIds);
    const confirmed = await showConfirm({
      title: folderIds.length ? '선택 항목 일괄 삭제' : '파일 일괄 삭제',
      message: (folderIds.length
        ? `선택한 ${what.join(', ')}를 휴지통으로 이동하시겠습니까?\n폴더 안의 파일·하위 폴더도 함께 이동되며, 30일 후 자동 영구 삭제됩니다.`
        : `선택한 ${fileIds.length}개 파일을 휴지통으로 이동하시겠습니까?`) + warning,
      confirmText: '삭제',
      danger: true,
    });
    if (!confirmed) return false;

    const toastId = showToast('휴지통으로 이동 중...', { type: 'loading', duration: 0 });

    if (onConfirmed) {
      await onConfirmed();
    }

    let failed = 0;
    for (const fid of fileIds) {
      try {
        await moveToTrashFile(fid);
      } catch (e) {
        failed += 1;
        console.error('Trash error:', e);
      }
    }
    // After the files, so a folder that held some of them is emptied first and
    // the trash entries stay individually restorable.
    for (const fid of folderIds) {
      try {
        await moveToTrashFolder(fid);
      } catch (e) {
        failed += 1;
        console.error('Trash error:', e);
      }
    }
    await refreshFiles();
    await refreshFoldersAndStats();
    setFavoriteRefreshToken((n) => n + 1);
    bumpWindowRefresh();
    updateToast(toastId, {
      message: failed
        ? `${what.join(', ')} 중 ${failed}개를 옮기지 못했습니다.`
        : `${what.join(', ')}를 휴지통으로 이동했습니다.`,
      type: failed ? 'error' : 'success',
    });

    if (!failed) {
      pushUndo({
        label: '삭제',
        undo: async () => {
          for (const fid of fileIds) await restoreFile(fid);
          for (const fid of folderIds) await restoreFolder(fid);
        },
      });
    }
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
    if (!currentUser || (!currentUser.is_approved && !currentUser.is_superadmin)) return;
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
    setActiveView('all');
    setCurrentPage(1);
    updateUrlParams({ wsId: ws?.id || null, folderId: null, view: 'all' });
  };


  // Fetch Folders and System Stats
  const refreshFoldersAndStats = useCallback(async () => {
    if (!currentUser || (!currentUser.is_approved && !currentUser.is_superadmin)) return;
    if (!isWorkspacesLoaded) return;
    if (!activeWorkspace?.id) {
      refreshFoldersRequestIdRef.current += 1;
      loadedFoldersWorkspaceIdRef.current = null;
      setFolders([]);
      setStats(null);
      setIsFoldersLoading(false);
      return;
    }
    if (loadedFoldersWorkspaceIdRef.current !== activeWorkspace.id) {
      setIsFoldersLoading(true);
    }
    // Guard against out-of-order responses: an upload completing in the
    // background (or any other trigger) can call this for a workspace the
    // user has since switched away from — if that slower request resolved
    // last, it would otherwise overwrite the correctly-loaded folder tree
    // with the previous workspace's, which is exactly what made switching
    // workspaces mid-upload briefly (or persistently) show the wrong
    // workspace's folders. Same pattern as refreshFiles's request-id guard.
    const requestId = ++refreshFoldersRequestIdRef.current;
    try {
      const wsId = activeWorkspace.id;
      const [tree, systemStats] = await Promise.all([
        getFolderTree(wsId),
        getSystemStats(wsId)
      ]);
      if (requestId !== refreshFoldersRequestIdRef.current) return; // a newer refresh superseded this one
      setFolders(tree);
      setStats(systemStats);
      loadedFoldersWorkspaceIdRef.current = wsId;
      setIsFoldersLoading(false);

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
      setIsFoldersLoading(false);
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

      // Sort/page live in the URL too, so a back/forward that lands on an
      // entry carrying them has to restore those as well — otherwise the
      // list would render with the previous entry's sort while the URL
      // advertised a different one.
      setSortBy(readSortByFromUrl());
      setSortOrder(readSortOrderFromUrl());
      setPageSize(readPageSizeFromUrl());
      setCurrentPage(readPageFromUrl());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeWorkspace?.id, workspaces]);

  // Mirror the live sort/page into the URL so a refresh restores exactly
  // this view. Running on mount also normalises a bad incoming URL: an
  // invalid value was already replaced by its default when state was
  // initialised, and this writes that correction back out, so a hand-edited
  // or stale link visibly becomes the newest-first, page-1 URL it fell back
  // to rather than keeping parameters the app is not actually honouring.
  useEffect(() => {
    updateUrlParams({ sortBy, sortOrder, page: currentPage, pageSize });
  }, [sortBy, sortOrder, currentPage, pageSize, updateUrlParams]);

  // A page number can be valid-looking yet past the end of the result set
  // (a bookmark from when the folder had more files, or files deleted since)
  // — that can only be judged once the server reports total_pages, so the
  // clamp lives here rather than in the URL parsing.
  useEffect(() => {
    const totalPages = paginationMeta?.total_pages;
    if (!totalPages) return; // no server response yet — nothing to clamp against
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [paginationMeta, currentPage]);

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
    if (uploaderFilter?.id) params.uploader_id = uploaderFilter.id;
    return params;
  }, [activeWorkspace?.id, activeView, activeFolderId, uploaderFilter?.id]);

  const refreshFiles = useCallback(async (silent = false) => {
    if (!currentUser || (!currentUser.is_approved && !currentUser.is_superadmin)) return;
    if (!isWorkspacesLoaded) return;
    if (!activeWorkspace?.id) {
      refreshFilesRequestIdRef.current += 1;
      setFiles([]);
      setPaginationMeta({
        total_count: 0,
        // Still "unknown", not a real one-page result — no workspace means
        // no listing was fetched, so this must not trigger the page clamp
        // (nothing is rendered in this state anyway).
        total_pages: null,
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

  // A batch of uploads lands one file at a time, and refetching the list on
  // each arrival would keep reshuffling the page under the person watching it
  // — hence the "새로고침" prompt while it runs. But once the batch is done
  // there is nothing left to disturb, so the prompt has served its purpose:
  // the view catches up on its own rather than leaving one last click to do.
  const wasUploadingRef = useRef(false);
  useEffect(() => {
    const wasUploading = wasUploadingRef.current;
    wasUploadingRef.current = uploadManager.isUploading;
    if (!wasUploading || uploadManager.isUploading) return;

    // Only where the files actually landed — and everywhere that place is on
    // screen: the folder window the upload was started from, another window
    // onto the same folder, and the main listing if it is showing it too.
    const targets = Array.from(uploadTargetsRef.current);
    uploadTargetsRef.current = new Set();
    bumpWindowRefresh(targets.length ? targets : null);
    refreshFoldersAndStats();
    const viewingKey = `${activeWorkspace?.id || 'none'}:${activeFolderId || 'root'}`;
    if (!targets.length || targets.includes(viewingKey)) {
      refreshFiles(true);
      setHasNewFilesInView(false);
    }
  }, [uploadManager.isUploading, refreshFiles, refreshFoldersAndStats, bumpWindowRefresh, activeWorkspace?.id, activeFolderId]);

  // Memoised: the copy-jobs banner keys its polling effect on this, so a fresh
  // arrow per render restarted the poll (and fired a request) on every render.
  const handleCopyJobsFinished = useCallback(() => {
    refreshFiles();
    refreshFoldersAndStats();
    bumpWindowRefresh();
  }, [refreshFiles, refreshFoldersAndStats, bumpWindowRefresh]);

  // Undo stack for operations that move or remove things.
  //
  // Each entry carries the inverse of what was just done, captured at the time
  // it was done — a move records where every item came from, one by one,
  // because a multi-select drag can pull items out of several folders at once
  // and "put it back" has to mean the folder each one actually left.
  //
  // Copy is deliberately absent: it is queued on the server and finishes
  // whether or not this page is still open, so there is nothing here that can
  // reliably know what to take back. Deleting the copies afterwards is a
  // normal delete, not an undo.
  const UNDO_LIMIT = 20;
  const [undoStack, setUndoStack] = useState([]);

  const pushUndo = useCallback((entry) => {
    setUndoStack((prev) => [...prev.slice(-(UNDO_LIMIT - 1)), entry]);
  }, []);

  const runUndo = useCallback(async () => {
    let entry = null;
    setUndoStack((prev) => {
      if (!prev.length) return prev;
      entry = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    // The state updater above runs synchronously enough for `entry` to be set,
    // but guard anyway rather than assuming it.
    await Promise.resolve();
    if (!entry) return;

    const toastId = showToast(`${entry.label} 되돌리는 중...`, { type: 'loading', duration: 0 });
    try {
      await entry.undo();
      await refreshFiles();
      await refreshFoldersAndStats();
      bumpWindowRefresh();
      updateToast(toastId, { message: `${entry.label}을(를) 되돌렸습니다.`, type: 'success' });
    } catch (err) {
      dismissToast(toastId);
      await showAlert({
        title: '되돌리기 실패',
        message: err.message || '되돌릴 수 없습니다. 대상이 이미 변경되었을 수 있습니다.',
        type: 'error',
      });
    }
  }, [showToast, updateToast, dismissToast, showAlert, refreshFiles, refreshFoldersAndStats, bumpWindowRefresh]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const el = document.activeElement;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      // A window or modal on top owns the keyboard while focus is inside it.
      if (el?.closest?.('.os-preview-window, .modal-overlay')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        runUndo();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [runUndo]);


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
    setCurrentPage(1);
    updateUrlParams({ folderId, view: newView });
    if (window.innerWidth <= 768) {
      setIsSidebarCollapsed(true);
    }
  };

  const handleSelectView = (viewName) => {
    setActiveView(viewName);
    setActiveFolderId(null);
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

  // Where a new thing goes when the screen is not a folder.
  //
  // The 문서 탭, 일정 탭 and 즐겨찾기 are queries across folders, not places —
  // so "새 문서" there had nowhere to put it, and in the shared workspace,
  // where the home holds nothing, it simply failed. It goes into your own
  // folder, which is the only place in that workspace it could go.
  const myPersonalFolderId = () => {
    if (!activeWorkspace?.is_shared) return null;
    const mine = folders.find((f) => f.owner_user_id === currentUser?.id)
      || folders.find((f) => f.name === currentUser?.username);
    return mine?.id ?? null;
  };

  const writeTargetFolderId = () => {
    if (activeView === 'folder' && activeFolderId) return activeFolderId;
    if (activeWorkspace?.is_shared) return myPersonalFolderId();
    return activeFolderId ?? null;
  };

  const writeTargetProblem = () => {
    if (activeWorkspace?.is_shared && !writeTargetFolderId()) {
      return '공용 워크스페이스에서는 본인 폴더 안에서만 만들 수 있습니다. 홈에서 내 폴더를 먼저 만들어 주세요.';
    }
    return null;
  };

  const handleNewNote = async () => {
    const problem = writeTargetProblem();
    if (problem) { showToast(problem, { type: 'warning' }); return; }
    try {
      const newNote = await createMarkdownNote({
        name: '제목 없는 문서',
        workspace_id: activeWorkspace?.id || null,
        folder_id: writeTargetFolderId(),
        content: '',
        tags: []
      });
      await refreshFiles();
      await refreshFoldersAndStats();
      bumpWindowRefresh();
      windowManager.openWindow(newNote);
    } catch (err) {
      await showAlert({
        title: '생성 실패',
        message: '새 문서 생성에 실패했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  /**
   * What a deletion would break, in words, before it happens.
   *
   * A file can be attached to several documents, and those documents keep
   * showing it. Deleting is still allowed — it is the person's file — but not
   * silently: the documents holding it are named first, and the deletion is
   * confirmed a second time.
   */
  const attachmentWarning = async (fileIds) => {
    if (!fileIds.length) return '';
    let byFile = {};
    try {
      byFile = await getFilesAttachedTo(fileIds);
    } catch (e) {
      return '';
    }
    const documents = new Map();
    for (const rows of Object.values(byFile)) {
      for (const doc of rows) documents.set(doc.id, doc);
    }
    if (documents.size === 0) return '';
    const names = [...documents.values()].map((d) => d.name);
    const shown = names.slice(0, 5).map((n) => `· ${n}`).join('\n');
    const rest = names.length > 5 ? `\n· 외 ${names.length - 5}개` : '';
    return `\n\n이 파일은 다음 문서에 첨부되어 있습니다:\n${shown}${rest}\n삭제하면 해당 문서에서 삭제된 첨부로 표시됩니다.`;
  };

  const handleTrashFile = async (file, onConfirmed) => {
    const warning = await attachmentWarning([file.id]);
    const confirmed = await showConfirm({
      title: '휴지통으로 이동',
      message: `'${file.name}' 파일을 휴지통으로 이동하시겠습니까?\n휴지통에서 언제든 복구할 수 있으며 30일 후 자동 영구 삭제됩니다.${warning}`,
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
      windowManager.closeWindow(file.id);
      refreshFiles();
      refreshFoldersAndStats();
      // Something deleted here may have been on somebody's 즐겨찾기 list, and
      // that list is built from its own request — it has to be asked again.
      setFavoriteRefreshToken((n) => n + 1);
      bumpWindowRefresh();
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
    const targetFile = files.find(f => f.id === fileId) || windowManager.windows.find(w => w.id === fileId)?.file;
    if (targetFile) {
      await handleTrashFile(targetFile, onConfirmed);
    } else {
      try {
        if (onConfirmed) {
          await onConfirmed();
        }
        await moveToTrashFile(fileId);
        windowManager.closeWindow(fileId);
        refreshFiles();
        refreshFoldersAndStats();
        setFavoriteRefreshToken((n) => n + 1);
        bumpWindowRefresh();
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
      setFavoriteRefreshToken((n) => n + 1);
      bumpWindowRefresh();
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
    bumpWindowRefresh();
    windowManager.updateWindowFile(id, { name: newName });
  };

  // Cut/copy/paste entries shared by the file, folder and background menus, so
  // the three stay in step and a selection is always acted on as a unit.
  const clipboardMenuItems = (fileIds, folderIds, pasteTargetId, ctx = null) => {
    const sourceWorkspaceId = ctx?.workspaceId ?? activeWorkspace?.id ?? null;
    const pasteWorkspaceId = ctx?.workspaceId ?? activeWorkspace?.id ?? null;
    // A menu raised inside a folder window acts on that window's folder, not
    // on whatever the main explorer happens to be showing.
    const sourceFolderId = ctx?.folderId !== undefined ? ctx.folderId : (activeFolderId ?? null);
    // The handlers accept either modifier; the hint shows the one the user's
    // own keyboard actually has, so it isn't wrong on half the machines.
    const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
    const items = [];
    if (fileIds.length || folderIds.length) {
      // Cutting moves the original, so it belongs with the writes. Copying
      // only reads, and reading other people's material is what the shared
      // workspace is for.
      if (ctx?.canWrite !== false) {
        items.push({ label: '잘라내기', icon: Scissors, shortcut: `${mod}X`, onClick: () => handleClipboardCut(fileIds, folderIds, sourceWorkspaceId, sourceFolderId) });
      }
      items.push({ label: '복사', icon: Copy, shortcut: `${mod}C`, onClick: () => handleClipboardCopy(fileIds, folderIds, sourceWorkspaceId) });
    }
    // Pasting writes, so it is offered only where writing is allowed. The
    // caller says whether this spot takes it; without an answer, the old
    // behaviour (offer it) is kept for places that have not been taught yet.
    if (clipboardHasItems && ctx?.canWrite !== false) {
      const count = clipboard.fileIds.length + clipboard.folderIds.length;
      const crossWorkspace = !!pasteWorkspaceId && clipboard.workspaceId !== pasteWorkspaceId;
      items.push({
        // Says which it will be, because across workspaces even a 잘라내기
        // duplicates and leaves the originals in the source's trash.
        label: crossWorkspace
          ? `${clipboard.mode === 'cut' ? '여기로 이동' : '여기에 복사'} (${count}개)`
          : `붙여넣기 (${count}개)`,
        icon: ClipboardPaste,
        shortcut: `${mod}V`,
        onClick: () => handleClipboardPaste(pasteTargetId, pasteWorkspaceId, ctx?.onDone),
      });
    }
    return items;
  };

  const handleFolderContextMenu = (e, folder, ctx = null) => {
    const selection = ctx?.selection ?? null;
    const fileIds = selection?.fileIds ?? [];
    const folderIds = selection?.folderIds?.length ? selection.folderIds : [folder.id];
    const folderWorkspaceId = ctx?.workspaceId ?? folder.workspace_id ?? activeWorkspace?.id ?? null;
    // The server says whether this reader may put things in this folder; the
    // menu offers only what it would accept. Everything that writes was on
    // offer inside other people's folders, and every one of them was refused.
    const canWriteFolder = folder.can_write !== false;
    // A personal folder in the shared workspace is made and named by the
    // workspace itself, so it is not renamed or thrown away by hand.
    const isPersonalFolder = !!folder.owner_user_id && !folder.parent_id
      && workspaces.some(w => w.id === folderWorkspaceId && w.is_shared);
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
          label: '새 창에서 열기',
          icon: ExternalLink,
          onClick: () => windowManager.openFolderWindow(folder, folderWorkspaceId),
        },
        // Only the owner's own personal folder can be shared, and only in the
        // shared workspace — elsewhere membership already decides who writes.
        ...(activeWorkspace?.is_shared && folder.owner_user_id === currentUser?.id ? [{
          label: '폴더 공유 설정',
          icon: Users,
          onClick: () => setShareFolder(folder),
        }] : []),
        {
          label: favoriteFolderIds.has(folder.id) ? '즐겨찾기 해제' : '즐겨찾기 등록',
          icon: Star,
          onClick: () => handleToggleFolderFavorite(folder),
        },
        ...(canWriteFolder ? [{
          label: '하위 폴더 생성',
          icon: FolderPlus,
          onClick: () => {
            setNewFolderParentId(folder.id);
            setIsNewFolderOpen(true);
          },
        }] : []),
        ...(canWriteFolder ? [{
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
              bumpWindowRefresh();
              windowManager.openWindow(newNote);
            } catch (err) {
              await showAlert({
                title: '생성 실패',
                message: '새 문서 생성에 실패했습니다: ' + err.message,
                type: 'error'
              });
            }
          },
        }] : []),
        ...(canWriteFolder ? [{
          label: '새 일정',
          icon: CalendarCheck,
          onClick: () => handleCreateBoard(folder.id),
        }] : []),
        {
          label: '폴더를 ZIP으로 다운로드',
          icon: FileArchive,
          onClick: () => startDownloadFolder(folder),
        },
        { divider: true },
        ...clipboardMenuItems(fileIds, folderIds, folder.id, { ...ctx, workspaceId: folderWorkspaceId, canWrite: canWriteFolder }),
        ...(canWriteFolder && !isPersonalFolder ? [
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
        ] : []),
        // The colour is decoration and stays available on your own folder.
        ...(canWriteFolder && isPersonalFolder ? [
          { divider: true },
          {
            label: '폴더 색상 변경',
            icon: Edit3,
            onClick: () => setRenameModal({ isOpen: true, item: { id: folder.id, name: folder.name, color: folder.color, type: 'folder', colorOnly: true } }),
          },
        ] : []),
      ]
    });
  };

  const handleFileContextMenu = (e, file, ctx = null) => {
    const selection = ctx?.selection ?? null;
    const fileIds = selection?.fileIds?.length ? selection.fileIds : [file.id];
    const folderIds = selection?.folderIds ?? [];
    const isMedia = file.file_type === 'image' || file.file_type === 'video' || file.file_type === 'pdf';
    // Whether reporting applies is a fact about *this file's* workspace, not
    // about the one the app happens to be switched to. A folder window can be
    // showing the shared workspace while the app is elsewhere, and the entry
    // went missing there — and appeared on private files in the reverse case.
    const fileWorkspaceId = file.workspace_id ?? ctx?.workspaceId ?? activeWorkspace?.id ?? null;
    const isSharedFile = workspaces.some(w => w.id === fileWorkspaceId && w.is_shared);
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
        // Only where it means something: reporting exists for material other
        // people can see, which is the shared workspace.
        ...(isSharedFile && file.created_by !== currentUser?.id ? [{
          label: '신고하기',
          icon: Flag,
          onClick: () => setReportFile(file),
        }] : []),
        // A 할 일's document moves and is deleted with its 일정, never on its
        // own. The entries that would only be refused are left out; renaming
        // stays, because that works and keeps the 할 일's name in step.
        ...(file.is_task_document ? [] : [{
          label: '다른 폴더로 이동',
          icon: FolderInput,
          onClick: () => handleOpenMoveModal(fileIds),
        }]),
        { divider: true },
        ...(file.is_task_document ? [] : clipboardMenuItems(fileIds, folderIds, ctx?.folderId ?? activeFolderId, ctx)),
        ...(file.is_task_document ? [] : [{ divider: true }]),
        {
          label: '이름 변경',
          icon: Edit3,
          onClick: () => setRenameModal({ isOpen: true, item: { id: file.id, name: file.name, type: 'file' } }),
        },
        ...(file.is_task_document ? [{
          label: '일정에서 삭제할 수 있습니다',
          icon: CalendarCheck,
          disabled: true,
          onClick: () => {},
        }] : [{
          label: '휴지통으로 이동',
          icon: Trash2,
          danger: true,
          onClick: () => handleTrashFile(file),
        }]),
      ]
    });
  };

  const handleBackgroundContextMenu = (e, ctx = null) => {
    // Whether this background belongs to a place that takes new things. A
    // folder window says so itself; in the main view it is the shared
    // workspace's home that does not.
    const here = ctx?.folderId !== undefined ? ctx.folderId : activeFolderId;
    const canWriteHere = ctx?.canWrite !== undefined
      ? ctx.canWrite
      : !(activeWorkspace?.is_shared && !here);
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(canWriteHere ? [
          {
            label: '새 문서 작성',
            icon: Plus,
            onClick: handleNewNote,
          },
          {
            label: '새 일정',
            icon: CalendarCheck,
            onClick: () => handleCreateBoard(here),
          },
          {
            label: '새 폴더 생성',
            icon: FolderPlus,
            onClick: () => {
              setNewFolderParentId(here);
              setIsNewFolderOpen(true);
            },
          },
          {
            label: '파일 업로드',
            icon: UploadCloud,
            onClick: openUpload,
          },
        ] : []),
        ...(clipboardHasItems ? [{ divider: true }, ...clipboardMenuItems([], [], here, { ...ctx, canWrite: canWriteHere })] : []),
        { divider: true },
        {
          label: '새로고침',
          icon: RefreshCw,
          onClick: () => {
            refreshFiles();
            refreshFoldersAndStats();
            bumpWindowRefresh();
          },
        },
      ]
    });
  };

  const handleToggleFavorite = async (file) => {
    const on = !file.is_favorite;
    try {
      // Through the favourites endpoint, not the file-update one: a favourite
      // is this reader's own bookmark, so it must not require permission to
      // *change the file* — which in the shared workspace nobody has outside
      // their own folder.
      await setFavorite('file', file.id, on);
      windowManager.updateWindowFile(file.id, { is_favorite: on });
      // The star is the only thing that changed anywhere else, so it is
      // changed in place rather than by refetching the whole listing: a
      // bookmark does not move a file, rename it, or alter any count.
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, is_favorite: on } : f)));
      setFavoriteRefreshToken((n) => n + 1);
      // Except here, where it decides whether the row belongs on screen at all.
      if (activeView === 'favorites') refreshFiles();
    } catch (err) {
      showToast(err.message || '즐겨찾기를 변경하지 못했습니다.', { type: 'error' });
    }
  };

  // A board is created where files are created, so it lands in the folder the
  // action was invoked from and inherits that folder's rules.
  const handleCreateBoard = useCallback(async (folderId = undefined) => {
    const targetFolderId = folderId !== undefined ? folderId : writeTargetFolderId();
    if (activeWorkspace?.is_shared && !targetFolderId) {
      showToast('공용 워크스페이스에서는 본인 폴더 안에서만 만들 수 있습니다.', { type: 'warning' });
      return;
    }
    try {
      const board = await createBoard({
        name: '제목 없는 일정',
        workspaceId: activeWorkspace?.id || null,
        folderId: targetFolderId ?? null,
      });
      await refreshFiles();
      refreshFoldersAndStats();
      bumpWindowRefresh();
      setScheduleRefreshToken((n) => n + 1);
      windowManager.openWindow({ ...board, is_markdown: false });
    } catch (err) {
      await showAlert({ title: '일정을 만들지 못했습니다', message: err.message, type: 'error' });
    }
  }, [activeWorkspace?.id, activeFolderId, refreshFiles, refreshFoldersAndStats, bumpWindowRefresh, windowManager, showAlert]);

  const handleCreateFolder = async ({ name, parent_id, color }) => {
    await createFolder({ 
      name, 
      parent_id, 
      workspace_id: activeWorkspace?.id || null, 
      color 
    });
    refreshFoldersAndStats();
  };

  // Nothing may be put at the shared workspace's home — the server refuses it,
  // and an upload that starts anyway ends in a failure message that does not
  // say why. Asked before anything is queued or any dialog opens.
  const uploadTargetProblem = () => {
    if (activeWorkspace?.is_shared && !writeTargetFolderId()) {
      return '공용 워크스페이스에서는 본인 폴더 안에만 올릴 수 있습니다.';
    }
    return null;
  };

  const openUpload = () => {
    const problem = uploadTargetProblem();
    if (problem) { showToast(problem, { type: 'warning' }); return; }
    setIsUploadOpen(true);
  };

  const handleDropFiles = (droppedFiles) => {
    if (!droppedFiles || droppedFiles.length === 0) return;
    const problem = uploadTargetProblem();
    if (problem) { showToast(problem, { type: 'warning' }); return; }
    uploadManager.checkAndQueueFiles(droppedFiles, writeTargetFolderId(), activeWorkspace?.id);
    setIsUploadOpen(true);
  };

  const handleLogout = () => {
    logout();
    setCurrentUser(null);
  };

  // 1. Loading state
  if (isAuthLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
        인증 상태를 확인하고 있습니다...
      </div>
    );
  }

  // 2. Not logged in -> Show Login
  if (!currentUser) {
    return (
      <LoginModal
        isOpen={true}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
        }}
      />
    );
  }

  // 3. Logged in but not approved and not admin -> Show Pending Approval
  if (!currentUser.is_approved && !currentUser.is_superadmin) {
    return (
      <PendingApprovalScreen
        user={currentUser}
        onApproved={(user) => setCurrentUser(user)}
        onLogout={handleLogout}
        onUserUpdated={setCurrentUser}
      />
    );
  }

  // 4. Approved, but with no handle yet — asked for one before anything else,
  //    because it is the name every other screen shows this person by.
  if (!currentUser.username && !currentUser.is_system) {
    return (
      <ChooseHandleScreen
        user={currentUser}
        onDone={setCurrentUser}
        onLogout={handleLogout}
      />
    );
  }

  // 5. Admin Dashboard View
  if (activeView === 'admin') {
    return (
      <AdminDashboard
        currentUser={currentUser}
        // Coming back from the full-screen admin view has to restore a
        // view that is CONSISTENT with activeFolderId, which is
        // deliberately left untouched while admin is open. Unconditionally
        // setting 'all' here desynced the two: buildFileViewParams would
        // then fetch with root_only (because activeView === 'all') while
        // currentFolder/the breadcrumb still resolved to the folder the
        // user came from — so that folder's header sat above root's file
        // list, and any folder whose root happened to hold no files of its
        // own rendered as "폴더가 비어 있습니다" despite being full.
        onBackToApp={() => {
          const restoredView = activeFolderId ? 'folder' : 'all';
          setActiveView(restoredView);
          updateUrlParams({ folderId: activeFolderId, view: restoredView });
        }}
      />
    );
  }

  // 5. Main Knowledge Base App
  return (
    <div className="app-container">
      {/* Mobile Drawer Backdrop */}
      {!isSidebarCollapsed && (
        <div 
          className="mobile-sidebar-backdrop" 
          onClick={() => setIsSidebarCollapsed(true)} 
        />
      )}

      <Sidebar
        currentUser={currentUser}
        pendingReportCount={pendingReportCount}
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
        isFoldersLoading={isFoldersLoading}
        activeFolderId={activeFolderId}
        onSelectFolder={handleSelectFolder}
        activeView={activeView}
        onSelectView={handleSelectView}
        onNewNote={handleNewNote}
        onNewFolder={(parentId) => {
          setNewFolderParentId(parentId !== undefined ? parentId : activeFolderId);
          setIsNewFolderOpen(true);
        }}
        onOpenUpload={openUpload}
        onFolderContextMenu={handleFolderContextMenu}
        onDirectMoveItems={handleDirectMoveItems}
        onTransferItems={handleTransferItems}
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
          onOpenUpload={openUpload}
          onOpenInvitations={() => setIsInvitationModalOpen(true)}
          currentFolder={currentFolder}
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigateHome={() => {
            setActiveFolderId(null);
            setActiveView('all');
          }}
          onOpenAdmin={() => setActiveView('admin')}
          onLogout={handleLogout}
        />

        {activeView === 'schedule' ? (
          <ScheduleExplorer
            workspaceId={activeWorkspace?.id}
            workspaceName={activeWorkspace?.name || ''}
            currentUser={currentUser}
            refreshToken={scheduleRefreshToken}
            onOpenBoard={(boardFile) => windowManager.openWindow(boardFile)}
            onOpenFolder={(folder, wsId) => windowManager.openFolderWindow(folder, wsId || activeWorkspace?.id)}
          />
        ) : activeView === 'reports' ? (
          <ReportsExplorer
            onOpenFile={handleOpenReportedFile}
            onResolved={() => {
              refreshReportCount();
              refreshFiles();
            }}
          />
        ) : activeView === 'trash' ? (
          <TrashExplorer
            activeWorkspace={activeWorkspace}
            currentUser={currentUser}
            onOpenMediaPreview={(file) => windowManager.openWindow(file)}
            onRefreshParent={() => {
              refreshFiles();
              refreshFoldersAndStats();
              bumpWindowRefresh();
            }}
          />
        ) : (
          <FolderExplorer
            currentUser={currentUser}
            onNewBoard={handleCreateBoard}
            favoriteFolderIds={favoriteFolderIds}
            onToggleFolderFavorite={handleToggleFolderFavorite}
            favoriteRefreshToken={favoriteRefreshToken}
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
            onOpenUpload={openUpload}
            onDeleteFile={handleDeleteFile}
            onToggleFavorite={handleToggleFavorite}
            onDropFiles={handleDropFiles}
            onFolderContextMenu={handleFolderContextMenu}
            onFileContextMenu={handleFileContextMenu}
            onBackgroundContextMenu={handleBackgroundContextMenu}
            clipboard={clipboard}
            onClipboardCut={handleClipboardCut}
            onClipboardCopy={handleClipboardCopy}
            onClipboardPaste={handleClipboardPaste}
            onDownloadFolder={startDownloadFolder}
            onDownloadFile={startDownloadFile}
            onOpenMoveModal={handleOpenMoveModal}
            onBatchDownload={handleBatchDownloadFiles}
            onBatchDelete={handleBatchTrashItems}
            onDirectMoveFiles={handleDirectMoveFiles}
            onDirectMoveItems={handleDirectMoveItems}
            onTransferItems={handleTransferItems}
            onOpenFolderWindow={(folder) => windowManager.openFolderWindow(folder, activeWorkspace?.id)}
            workspaceId={activeWorkspace?.id || null}
            isSharedWorkspace={!!activeWorkspace?.is_shared}
            uploaderFilter={uploaderFilter}
            onFilterUploader={(u) => { setUploaderFilter(u); setCurrentPage(1); }}
            canWrite={activeWorkspace?.can_write !== false}
            onSelectAllInFolder={async () => {
              const viewParams = buildFileViewParams();
              if (!viewParams) return [];
              const res = await listFileIds(viewParams);
              return res.file_ids || [];
            }}
            allFolders={folders}
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
          // Pass through what the search hit already knows. PreviewWindow
          // picks its viewer from name/file_type, so opening with only an id
          // meant every type check fell through and even an image rendered
          // as the generic "download this file" panel. It refetches the rest
          // (size, content) itself when the object is incomplete.
          handleOpenFile({
            id: item.file_id,
            name: item.file_name,
            file_type: item.file_type,
            is_markdown: item.is_markdown,
            folder_id: item.folder_id,
            workspace_id: item.workspace_id,
            created_at: item.created_at,
            updated_at: item.updated_at
          });
        }}
      />

      <ChunkedUploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        activeWorkspaceId={activeWorkspace?.id || null}
        currentFolderId={activeFolderId}
        folders={folders}
        workspaces={workspaces}
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
          activeWorkspaceId={activeWorkspace?.id || null}
          workspaces={workspaces}
        />
      )}

      <NewFolderModal
        isOpen={isNewFolderOpen}
        onClose={() => setIsNewFolderOpen(false)}
        parentFolderId={newFolderParentId ?? (activeWorkspace?.is_shared ? myPersonalFolderId() : null)}
        isSharedWorkspace={!!activeWorkspace?.is_shared}
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
      {/* Background copy queue — visible whenever the server is working, and
          able to pick up jobs this browser session did not start. */}
      <CopyJobsBanner
        notifyPermissionTrigger={queuedJobCount}
        onJobsFinished={handleCopyJobsFinished}
      />

      <WindowManager
        windowManager={windowManager}
        workspaces={workspaces}
        onToggleFavorite={handleToggleFavorite}
        onDeleteFile={handleDeleteFile}
        activeWorkspaceId={activeWorkspace?.id}
        currentUser={currentUser}
        onFileContextMenu={handleFileContextMenu}
        onFolderContextMenu={handleFolderContextMenu}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        clipboard={clipboard}
        onClipboardCut={handleClipboardCut}
        onClipboardCopy={handleClipboardCopy}
        onClipboardPaste={handleClipboardPaste}
        onTransferItems={handleTransferItems}
        onUploadFiles={(picked, folderId, workspaceId) => {
          // Reuses the existing upload queue, but targeted at the window's own
          // folder and workspace rather than whatever the app is showing.
          uploadManager.checkAndQueueFiles(picked, folderId, workspaceId);
          setIsUploadOpen(true);
        }}
        onUndo={runUndo}
        externalRefreshToken={windowRefreshToken}
      />

      <FolderShareModal
        isOpen={!!shareFolder}
        folder={shareFolder}
        onClose={() => setShareFolder(null)}
      />

      <ReportModal
        isOpen={!!reportFile}
        file={reportFile}
        onClose={() => setReportFile(null)}
        onDone={refreshReportCount}
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
  );
}
