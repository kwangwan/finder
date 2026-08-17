import { useState, useRef, useCallback, useEffect } from 'react';
import { uploadFileChunked, ensureFolderPath } from '../api';

const MAX_CONCURRENT_UPLOADS = 2;

export function useUploadManager({ onUploadSuccess } = {}) {
  const [queue, setQueue] = useState([]);
  const activeWorkersRef = useRef(0);
  const queueRef = useRef([]);
  const abortControllersRef = useRef(new Map());
  const folderIdCacheRef = useRef(new Map());
  const folderInFlightPromisesRef = useRef(new Map());

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const activeCount = queue.filter(t => t.status === 'uploading' || t.status === 'pending').length;
  const completedCount = queue.filter(t => t.status === 'completed').length;
  const errorCount = queue.filter(t => t.status === 'error' || t.status === 'canceled').length;
  const isUploading = activeCount > 0;

  // Warning when refreshing/leaving page while upload is in progress
  useEffect(() => {
    if (!isUploading) return;

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '현재 파일 업로드가 진행 중입니다. 페이지를 벗어나거나 새로고침하면 업로드가 취소됩니다.';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isUploading]);

  const updateItem = useCallback((id, updates) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }, []);

  /**
   * Thread-safe in-flight promise caching for folder creation.
   * Prevents concurrent workers from creating duplicate folders with identical paths.
   */
  const resolveFolderPath = useCallback(async (targetWsId, parentFolderId, folderPath) => {
    if (!folderPath || !targetWsId) return parentFolderId || null;

    const cacheKey = `${targetWsId}:${parentFolderId || 'root'}:${folderPath}`;
    
    // 1. Return cached ID if already resolved
    if (folderIdCacheRef.current.has(cacheKey)) {
      return folderIdCacheRef.current.get(cacheKey);
    }

    // 2. If a request is already in flight for this exact path, await the existing promise
    if (folderInFlightPromisesRef.current.has(cacheKey)) {
      return folderInFlightPromisesRef.current.get(cacheKey);
    }

    // 3. Create a single in-flight promise shared by all workers
    const promise = (async () => {
      try {
        const ensured = await ensureFolderPath(targetWsId, parentFolderId || null, folderPath);
        folderIdCacheRef.current.set(cacheKey, ensured.folder_id);
        return ensured.folder_id;
      } finally {
        folderInFlightPromisesRef.current.delete(cacheKey);
      }
    })();

    folderInFlightPromisesRef.current.set(cacheKey, promise);
    return promise;
  }, []);

  const processNextItem = useCallback(async () => {
    if (activeWorkersRef.current >= MAX_CONCURRENT_UPLOADS) return;

    const currentQueue = queueRef.current;
    const nextItem = currentQueue.find(it => it.status === 'pending');
    if (!nextItem) return;

    activeWorkersRef.current += 1;
    const controller = new AbortController();
    abortControllersRef.current.set(nextItem.id, controller);

    updateItem(nextItem.id, { status: 'uploading', statusText: '업로드 준비 중...' });

    try {
      let targetFolderId = nextItem.targetFolderId || null;
      const targetWsId = nextItem.activeWorkspaceId || null;

      // If relative path exists (from folder drop/selection), ensure folder hierarchy exists
      if (nextItem.relativePath && nextItem.relativePath.includes('/')) {
        const pathParts = nextItem.relativePath.split('/');
        pathParts.pop(); // Remove filename
        const folderPath = pathParts.join('/');

        if (folderPath && targetWsId) {
          updateItem(nextItem.id, { statusText: `폴더 구조 확인 중 (${folderPath})...` });
          targetFolderId = await resolveFolderPath(targetWsId, nextItem.targetFolderId || null, folderPath);
          updateItem(nextItem.id, { targetFolderId });
        }
      }

      updateItem(nextItem.id, { statusText: '파일 전송 중...' });

      await uploadFileChunked(
        nextItem.file, 
        targetFolderId, 
        targetWsId, 
        ({ percent, status }) => {
          updateItem(nextItem.id, { percent, statusText: status });
        },
        controller.signal
      );

      updateItem(nextItem.id, { percent: 100, status: 'completed', statusText: '완료됨' });
      if (onUploadSuccess) {
        onUploadSuccess({
          ...nextItem,
          targetFolderId,
          activeWorkspaceId: targetWsId
        });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        updateItem(nextItem.id, { status: 'canceled', statusText: '사용자에 의해 취소됨' });
      } else {
        console.error('Upload item failed:', err);
        updateItem(nextItem.id, { status: 'error', statusText: '업로드 실패: ' + (err.message || '오류 발생') });
      }
    } finally {
      abortControllersRef.current.delete(nextItem.id);
      activeWorkersRef.current = Math.max(0, activeWorkersRef.current - 1);
      // Spawn next item in queue
      setTimeout(() => {
        processNextItem();
      }, 20);
    }
  }, [updateItem, onUploadSuccess, resolveFolderPath]);

  const startWorkerPool = useCallback(() => {
    for (let i = 0; i < MAX_CONCURRENT_UPLOADS; i++) {
      processNextItem();
    }
  }, [processNextItem]);

  const addFilesToQueue = useCallback((fileList, targetFolderId, activeWorkspaceId) => {
    if (!fileList || fileList.length === 0) return;

    // Filter out files that might already be in queue or duplicate instances
    const newItems = Array.from(fileList).map(file => {
      const relPath = file.relativePath || file.webkitRelativePath || '';
      return {
        id: 'up_' + Date.now() + '_' + Math.random().toString(36).substr(2, 7),
        file,
        name: file.name,
        size: file.size,
        relativePath: relPath,
        targetFolderId,
        activeWorkspaceId,
        percent: 0,
        status: 'pending', // 'pending' | 'uploading' | 'completed' | 'error' | 'canceled'
        statusText: '대기 중...'
      };
    });

    setQueue(prev => [...prev, ...newItems]);

    // Pre-resolve folder paths in background so folder trees exist before workers begin
    const uniquePaths = new Set();
    newItems.forEach(it => {
      if (it.relativePath && it.relativePath.includes('/')) {
        const parts = it.relativePath.split('/');
        parts.pop();
        const p = parts.join('/');
        if (p) uniquePaths.add(p);
      }
    });

    if (uniquePaths.size > 0 && activeWorkspaceId) {
      uniquePaths.forEach(async (p) => {
        try {
          const resolvedId = await resolveFolderPath(activeWorkspaceId, targetFolderId, p);
          if (resolvedId) {
            setQueue(prev => prev.map(item => {
              if (item.relativePath && (item.relativePath === p || item.relativePath.startsWith(p + '/'))) {
                return { ...item, targetFolderId: resolvedId };
              }
              return item;
            }));
          }
        } catch (e) {}
      });
    }

    // Trigger process in next tick
    setTimeout(() => {
      startWorkerPool();
    }, 50);
  }, [startWorkerPool, resolveFolderPath]);

  const cancelUpload = useCallback((id) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
    setQueue(prev => prev.map(it => {
      if (it.id === id) {
        return { ...it, status: 'canceled', statusText: '취소됨' };
      }
      return it;
    }));
  }, []);

  const cancelAll = useCallback(() => {
    abortControllersRef.current.forEach(controller => controller.abort());
    abortControllersRef.current.clear();
    setQueue(prev => prev.map(it => {
      if (it.status === 'uploading' || it.status === 'pending') {
        return { ...it, status: 'canceled', statusText: '취소됨' };
      }
      return it;
    }));
  }, []);

  const removeItem = useCallback((id) => {
    cancelUpload(id);
    setQueue(prev => prev.filter(it => it.id !== id));
  }, [cancelUpload]);

  const retryItem = useCallback((id) => {
    setQueue(prev => prev.map(it => it.id === id ? { ...it, status: 'pending', percent: 0, statusText: '재시도 대기 중...' } : it));
    setTimeout(() => {
      startWorkerPool();
    }, 50);
  }, [startWorkerPool]);

  const clearCompleted = useCallback(() => {
    setQueue(prev => prev.filter(it => it.status !== 'completed'));
  }, []);

  const clearAll = useCallback(() => {
    cancelAll();
    setQueue([]);
  }, [cancelAll]);

  const totalProgress = queue.length > 0
    ? Math.round(queue.reduce((acc, t) => acc + (t.percent || (t.status === 'completed' ? 100 : 0)), 0) / queue.length)
    : 0;

  return {
    queue,
    isUploading,
    activeCount,
    completedCount,
    errorCount,
    totalProgress,
    addFilesToQueue,
    cancelUpload,
    cancelAll,
    removeItem,
    retryItem,
    clearCompleted,
    clearAll
  };
}
