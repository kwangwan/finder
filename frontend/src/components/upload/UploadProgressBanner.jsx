import React from 'react';
import { 
  UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  X, 
  Square,
  ChevronRight
} from '../../utils/icons';

export default function UploadProgressBanner({
  uploadManager,
  onOpenModal,
  activeWorkspaceId,
  workspaces = []
}) {
  const {
    queue,
    isUploading,
    activeCount,
    completedCount,
    errorCount,
    totalProgress,
    cancelAll,
    clearAll
  } = uploadManager;

  // Don't show if nothing in queue
  if (!queue || queue.length === 0) return null;

  // Active current uploading item
  const currentItem = queue.find(it => it.status === 'uploading') || queue.find(it => it.status === 'pending');

  return (
    <div 
      className="upload-progress-floating-banner" 
      onClick={onOpenModal}
      role="status"
      aria-live="polite"
      title="클릭하여 업로드 상세 내역 보기"
    >
      <div className="upload-banner-inner">
        {/* Left Status Icon */}
        <div className="upload-banner-icon-box">
          {isUploading ? (
            <div className="upload-banner-spinner-wrap">
              <Loader2 size={16} className="spin-anim" color="var(--accent-primary)" />
            </div>
          ) : errorCount > 0 ? (
            <AlertCircle size={17} color="#ef4444" />
          ) : (
            <CheckCircle2 size={17} color="#10b981" />
          )}
        </div>

        {/* Middle Info */}
        <div className="upload-banner-info">
          <div className="upload-banner-title-row">
            <span className="upload-banner-title">
              {isUploading ? (
                <>업로드 중 ({activeCount}개 남음 · {totalProgress}%)</>
              ) : errorCount > 0 ? (
                <>{errorCount}개 파일 업로드 실패</>
              ) : (
                <>{completedCount}개 파일 업로드 완료</>
              )}
            </span>
          </div>

          {/* Progress Bar or File Name */}
          {isUploading && (
            <div className="upload-banner-progress-track">
              <div 
                className="upload-banner-progress-fill" 
                style={{ width: `${totalProgress}%` }}
              />
            </div>
          )}

          {currentItem && isUploading && (
            <div className="upload-banner-current-file">
              {currentItem.name} ({currentItem.percent || 0}%)
            </div>
          )}

          {currentItem && isUploading && currentItem.activeWorkspaceId && currentItem.activeWorkspaceId !== activeWorkspaceId && (
            <div className="upload-banner-workspace-line">
              {workspaces.find(w => w.id === currentItem.activeWorkspaceId)?.name || '다른 워크스페이스'}
            </div>
          )}
        </div>

        {/* Right Action Buttons */}
        <div className="upload-banner-actions" onClick={e => e.stopPropagation()}>
          {isUploading && (
            <button
              type="button"
              className="upload-banner-btn-view"
              onClick={cancelAll}
              title="전체 업로드 중단"
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', padding: '0.2rem 0.45rem' }}
            >
              <Square size={10} fill="#ef4444" />
              <span>중단</span>
            </button>
          )}

          <button
            type="button"
            className="upload-banner-btn-view"
            onClick={onOpenModal}
            title="업로드 상세 보기"
          >
            <span>상세</span>
            <ChevronRight size={13} />
          </button>

          {!isUploading && (
            <button
              type="button"
              className="upload-banner-btn-close"
              onClick={clearAll}
              title="알림 닫기"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
