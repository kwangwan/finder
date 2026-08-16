import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import FolderExplorer from './components/explorer/FolderExplorer';
import MarkdownEditor from './components/editor/MarkdownEditor';
import SemanticSearchModal from './components/search/SemanticSearchModal';
import ChunkedUploadModal from './components/upload/ChunkedUploadModal';
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
} from 'lucide-react';
import { 
  getMe,
  logout,
  listWorkspaces,
  getFolderTree, 
  listFiles, 
  getFileDetail, 
  createMarkdownNote, 
  updateMarkdownNote, 
  deleteFile, 
  createFolder, 
  deleteFolder,
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

export default function App() {
  const { showAlert, showConfirm } = useDialog();
  const [theme, setTheme] = useState(() => localStorage.getItem('kb_theme') || 'dark');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  
  // Auth State
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Workspaces State
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [isCreateWorkspaceMode, setIsCreateWorkspaceMode] = useState(false);

  // Navigation & View
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [activeView, setActiveView] = useState('all'); // 'all' | 'notes' | 'favorites' | 'trash' | 'folder' | 'admin'
  const [files, setFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

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
  const [uploadInitialFiles, setUploadInitialFiles] = useState([]);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState(null);
  const [isInvitationModalOpen, setIsInvitationModalOpen] = useState(false);
  const [mediaPreviewFile, setMediaPreviewFile] = useState(null);
  const [contextMenu, setContextMenu] = useState({ isOpen: false, x: 0, y: 0, items: [] });
  const [renameModal, setRenameModal] = useState({ isOpen: false, item: null });

  // Sync theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kb_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
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
      await showAlert({
        title: '파일 이동 완료',
        message: `${res.moved_count}개의 파일이 성공적으로 이동되었습니다.`,
        type: 'success',
      });
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
      await showAlert({
        title: '파일 이동 완료',
        message: `${res.moved_count}개의 파일이 지정한 폴더로 이동되었습니다.`,
        type: 'success',
      });
    } catch (err) {
      await showAlert({
        title: '이동 실패',
        message: '파일 이동 중 오류가 발생했습니다: ' + err.message,
        type: 'error',
      });
    }
  };

  const handleBatchTrashFiles = async (fileIds) => {
    if (!fileIds || fileIds.length === 0) return;
    const confirmed = await showConfirm({
      title: '파일 일괄 삭제',
      message: `선택한 ${fileIds.length}개 파일을 휴지통으로 이동하시겠습니까?`,
      confirmText: '삭제',
      danger: true,
    });
    if (!confirmed) return;

    for (const fid of fileIds) {
      try {
        await moveToTrashFile(fid);
      } catch (e) {
        console.error('Trash error:', e);
      }
    }
    await refreshFiles();
    await refreshFoldersAndStats();
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
      
      const savedWsId = localStorage.getItem('kb_active_ws_id');
      const matched = wsList.find(w => w.id === savedWsId);

      if (matched) {
        setActiveWorkspace(matched);
      } else if (wsList.length > 0) {
        setActiveWorkspace(wsList[0]);
        localStorage.setItem('kb_active_ws_id', wsList[0].id);
      } else {
        setActiveWorkspace(null);
      }
    } catch (err) {
      console.error('Error loading workspaces:', err);
    } finally {
      setIsWorkspacesLoaded(true);
    }
  }, [currentUser]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleSelectWorkspace = (ws) => {
    setActiveWorkspace(ws);
    localStorage.setItem('kb_active_ws_id', ws.id);
    setActiveFolderId(null);
    setActiveFile(null);
    setActiveView('all');
    setCurrentPage(1);
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
    } catch (err) {
      console.error('Error loading folders/stats:', err);
    }
  }, [currentUser, isWorkspacesLoaded, activeWorkspace?.id]);

  useEffect(() => {
    refreshFoldersAndStats();
  }, [refreshFoldersAndStats]);

  // Fetch Files for active workspace with sorting and pagination
  const refreshFiles = useCallback(async () => {
    if (!currentUser || (!currentUser.is_approved && !currentUser.is_admin)) return;
    if (!isWorkspacesLoaded) return;
    if (!activeWorkspace?.id) {
      setFiles([]);
      setPaginationMeta({
        total_count: 0,
        total_pages: 1,
        page: 1,
        page_size: pageSize
      });
      return;
    }
    setIsLoading(true);
    try {
      let params = {
        workspace_id: activeWorkspace.id,
        sort_by: sortBy,
        sort_order: sortOrder,
        page: currentPage,
        page_size: pageSize,
        paged: true
      };
      if (activeView === 'folder' && activeFolderId) {
        params.folder_id = activeFolderId;
      } else if (activeView === 'notes') {
        params.file_type = 'markdown';
      } else if (activeView === 'favorites') {
        params.is_favorite = true;
      }

      const res = await listFiles(params);
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
    } catch (err) {
      console.error('Error fetching files:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, isWorkspacesLoaded, activeWorkspace?.id, activeView, activeFolderId, sortBy, sortOrder, currentPage, pageSize]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

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

  // Helper to find folder and build breadcrumb path
  const findFolderById = (nodeList, id) => {
    for (const node of nodeList) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findFolderById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const buildFolderPath = (nodeList, targetId) => {
    const path = [];
    function traverse(nodes, id) {
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
  };

  const currentFolder = activeFolderId ? findFolderById(folders, activeFolderId) : null;
  const currentFolderPath = activeFolderId ? buildFolderPath(folders, activeFolderId) : [];
  const currentSubfolders = currentFolder ? (currentFolder.children || []) : (activeView === 'all' ? folders : []);

  // Folder navigation
  const handleSelectFolder = (folderId) => {
    setActiveFolderId(folderId);
    setActiveView('folder');
    setActiveFile(null);
    setCurrentPage(1);
    if (window.innerWidth <= 768) {
      setIsSidebarCollapsed(true);
    }
  };

  const handleSelectView = (viewName) => {
    setActiveView(viewName);
    setActiveFolderId(null);
    setActiveFile(null);
    setCurrentPage(1);
    if (window.innerWidth <= 768) {
      setIsSidebarCollapsed(true);
    }
  };

  const handleOpenFile = async (file) => {
    try {
      const detail = await getFileDetail(file.id);
      setActiveFile(detail);
    } catch (err) {
      await showAlert({
        title: '조회 실패',
        message: '파일 상세 정보를 불러오지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleNewNote = async () => {
    try {
      const newNote = await createMarkdownNote({
        name: '새 문서',
        workspace_id: activeWorkspace?.id || null,
        folder_id: activeFolderId,
        content: '# 새 문서\n\n여기에 지식을 작성하세요.',
        tags: []
      });
      await refreshFiles();
      await refreshFoldersAndStats();
      setActiveFile(newNote);
    } catch (err) {
      await showAlert({
        title: '생성 실패',
        message: '새 노트 생성에 실패했습니다: ' + err.message,
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

  const handleTrashFile = async (file) => {
    const confirmed = await showConfirm({
      title: '휴지통으로 이동',
      message: `'${file.name}' 파일을 휴지통으로 이동하시겠습니까?\n휴지통에서 언제든 복구할 수 있으며 30일 후 자동 영구 삭제됩니다.`,
      type: 'danger',
      confirmText: '휴지통으로 이동',
      cancelText: '취소'
    });
    if (!confirmed) return;

    try {
      await moveToTrashFile(file.id);
      if (activeFile?.id === file.id) {
        setActiveFile(null);
      }
      refreshFiles();
      refreshFoldersAndStats();
      await showAlert({
        title: '휴지통 이동 완료',
        message: `'${file.name}' 파일이 휴지통으로 이동되었습니다.`,
        type: 'success'
      });
    } catch (err) {
      await showAlert({
        title: '휴지통 이동 실패',
        message: '파일을 휴지통으로 이동하지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleDeleteFile = async (fileId) => {
    const targetFile = files.find(f => f.id === fileId) || activeFile;
    if (targetFile) {
      await handleTrashFile(targetFile);
    } else {
      try {
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
      message: `'${folder.name}' 폴더와 하위 모든 파일/하위 폴더를 휴지통으로 이동하시겠습니까?\n휴지통에서 언제든 복구할 수 있으며 30일 후 자동 영구 삭제됩니다.`,
      type: 'danger',
      confirmText: '휴지통으로 이동',
      cancelText: '취소'
    });
    if (!confirmed) return;

    try {
      await moveToTrashFolder(folder.id);
      if (activeFolderId === folder.id) {
        setActiveFolderId(null);
        setActiveView('all');
      }
      refreshFiles();
      refreshFoldersAndStats();
      await showAlert({
        title: '휴지통 이동 완료',
        message: `'${folder.name}' 폴더가 휴지통으로 이동되었습니다.`,
        type: 'success'
      });
    } catch (err) {
      await showAlert({
        title: '휴지통 이동 실패',
        message: '폴더를 휴지통으로 이동하지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleRenameItem = async (id, newName, type) => {
    if (type === 'folder') {
      await renameFolder(id, newName);
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
          label: '새 노트 작성',
          icon: Plus,
          onClick: async () => {
            try {
              const newNote = await createMarkdownNote({
                name: '새 문서',
                workspace_id: activeWorkspace?.id || null,
                folder_id: folder.id,
                content: '# 새 문서\n\n여기에 지식을 작성하세요.',
                tags: []
              });
              await refreshFiles();
              await refreshFoldersAndStats();
              setActiveFile(newNote);
            } catch (err) {
              await showAlert({
                title: '생성 실패',
                message: '새 노트 생성에 실패했습니다: ' + err.message,
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
          label: '이름 변경',
          icon: Edit3,
          onClick: () => setRenameModal({ isOpen: true, item: { id: folder.id, name: folder.name, type: 'folder' } }),
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
          label: '새 노트 작성',
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
      setUploadInitialFiles(Array.from(droppedFiles));
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
  if (!currentUser.is_approved && !currentUser.is_admin) {
    return (
      <PendingApprovalScreen
        user={currentUser}
        onApproved={(user) => setCurrentUser(user)}
        onLogout={handleLogout}
      />
    );
  }

  // 4. Admin Dashboard View
  if (activeView === 'admin') {
    return (
      <AdminDashboard
        currentUser={currentUser}
        onBackToApp={() => setActiveView('all')}
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
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
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
      />

      <div className="main-content">
        <TopBar
          currentUser={currentUser}
          onToggleSidebar={() => setIsSidebarCollapsed(prev => !prev)}
          onOpenSearch={() => setIsSearchOpen(true)}
          onNewNote={handleNewNote}
          onOpenUpload={() => setIsUploadOpen(true)}
          onOpenInvitations={() => setIsInvitationModalOpen(true)}
          currentFolder={currentFolder}
          currentFile={activeFile}
          theme={theme}
          onToggleTheme={toggleTheme}
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
            onOpenMediaPreview={(file) => setMediaPreviewFile(file)}
            onRefreshParent={() => {
              refreshFiles();
              refreshFoldersAndStats();
            }}
          />
        ) : activeFile ? (
          <MarkdownEditor
            file={activeFile}
            onSave={handleSaveNote}
            onBack={() => setActiveFile(null)}
            onDelete={handleDeleteFile}
            onToggleFavorite={handleToggleFavorite}
            onNavigateFolder={(folderId) => {
              setActiveFile(null);
              setActiveFolderId(folderId);
              setActiveView(folderId ? 'folder' : 'all');
            }}
          />
        ) : (
          <FolderExplorer
            currentFolder={currentFolder}
            subfolders={currentSubfolders}
            files={files}
            folderPath={currentFolderPath}
            onSelectFolder={handleSelectFolder}
            onOpenFile={handleOpenFile}
            onOpenMediaPreview={(file) => setMediaPreviewFile(file)}
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
        onClose={() => {
          setIsUploadOpen(false);
          setUploadInitialFiles([]);
        }}
        activeWorkspaceId={activeWorkspace?.id || null}
        currentFolderId={activeFolderId}
        folders={folders}
        initialFiles={uploadInitialFiles}
        onUploadSuccess={() => {
          refreshFiles();
          refreshFoldersAndStats();
        }}
      />

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

      {/* Media Preview Modal (Image Lightbox & Video Player) */}
      <MediaPreviewModal
        isOpen={!!mediaPreviewFile}
        onClose={() => setMediaPreviewFile(null)}
        file={mediaPreviewFile}
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
