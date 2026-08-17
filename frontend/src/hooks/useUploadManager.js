import { useState, useRef, useCallback, useEffect } from 'react';
import { uploadFileChunked, ensureFolderPath } from '../api';

export function useUploadManager({ onUploadSuccess } = {}) {
  const [queue, setQueue] = useState([]);
  const isProcessingRef = useRef(false);
  const queueRef = useRef([]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const updateItem = useCallback((id, updates) => {
    setQueue(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }, []);

  const processQueue = useCallback(async (activeWorkspaceId) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      while (true) {
        const currentQueue = queueRef.current;
        const nextItem = currentQueue.find(it => it.status === 'pending');
        if (!nextItem) break;

        updateItem(nextItem.id, { status: 'uploading', statusText: '업로드 준비 중...' });

        try {
          let targetFolderId = nextItem.targetFolderId || null;

          // If relative path exists (from folder drop/selection), ensure folder hierarchy exists
          if (nextItem.relativePath && nextItem.relativePath.includes('/')) {
            const pathParts = nextItem.relativePath.split('/');
            pathParts.pop(); // Remove filename
            const folderPath = pathParts.join('/');

            if (folderPath && activeWorkspaceId) {
              updateItem(nextItem.id, { statusText: `폴더 구조 확인 중 (${folderPath})...` });
              const ensured = await ensureFolderPath(activeWorkspaceId, nextItem.targetFolderId || null, folderPath);
              targetFolderId = ensured.folder_id;
            }
          }

          updateItem(nextItem.id, { statusText: '파일 전송 중...' });

          await uploadFileChunked(
            nextItem.file, 
            targetFolderId, 
            activeWorkspaceId || null, 
            ({ percent, status }) => {
              updateItem(nextItem.id, { percent, statusText: status });
            }
          );

          updateItem(nextItem.id, { percent: 100, status: 'completed', statusText: '완료됨' });
          if (onUploadSuccess) onUploadSuccess();
        } catch (err) {
          console.error('Upload item failed:', err);
          updateItem(nextItem.id, { status: 'error', statusText: '업로드 실패: ' + (err.message || '오류 발생') });
        }
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [updateItem, onUploadSuccess]);

  const addFilesToQueue = useCallback((fileList, targetFolderId, activeWorkspaceId) => {
    if (!fileList || fileList.length === 0) return;

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
        status: 'pending', // 'pending' | 'uploading' | 'completed' | 'error'
        statusText: '대기 중...'
      };
    });

    setQueue(prev => [...prev, ...newItems]);

    // Trigger process in next tick
    setTimeout(() => {
      processQueue(activeWorkspaceId);
    }, 50);
  }, [processQueue]);

  const removeItem = useCallback((id) => {
    setQueue(prev => prev.filter(it => it.id !== id));
  }, []);

  const retryItem = useCallback((id, activeWorkspaceId) => {
    setQueue(prev => prev.map(it => it.id === id ? { ...it, status: 'pending', percent: 0, statusText: '재시도 대기 중...' } : it));
    setTimeout(() => {
      processQueue(activeWorkspaceId);
    }, 50);
  }, [processQueue]);

  const clearCompleted = useCallback(() => {
    setQueue(prev => prev.filter(it => it.status !== 'completed'));
  }, []);

  const clearAll = useCallback(() => {
    setQueue([]);
  }, []);

  const activeCount = queue.filter(t => t.status === 'uploading' || t.status === 'pending').length;
  const completedCount = queue.filter(t => t.status === 'completed').length;
  const errorCount = queue.filter(t => t.status === 'error').length;
  const isUploading = activeCount > 0;

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
    removeItem,
    retryItem,
    clearCompleted,
    clearAll
  };
}
