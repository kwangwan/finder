import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  X, 
  RotateCcw, 
  Trash2, 
  AlertTriangle, 
  FileText, 
  Image as ImageIcon, 
  FileCode, 
  File, 
  Film, 
  Music, 
  Eye, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Calendar,
  Clock,
  HardDrive
} from '../../utils/icons';
import { getFileDetail, getMediaPreviewUrl } from '../../api';
import VideoPlayer from '../common/VideoPlayer';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TrashPreviewModal({
  file,
  onClose,
  onRestore,
  onPermanentDelete,
  canPurge,
  isActionLoading
}) {
  const [fileDetail, setFileDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    if (!file) return;

    let isMounted = true;
    setIsLoading(true);

    const loadDetail = async () => {
      try {
        const detail = await getFileDetail(file.id);
        if (isMounted) setFileDetail(detail);
      } catch (err) {
        console.warn('Could not load trash file detail:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadDetail();
    return () => { isMounted = false; };
  }, [file]);

  if (!file) return null;

  const fileName = file.name || '파일 미리보기';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const isImage = file.file_type === 'image' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico'].includes(ext);
  const isVideo = file.file_type === 'video' || ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(ext);
  const isAudio = file.file_type === 'audio' || ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'].includes(ext);
  const isPdf = file.file_type === 'pdf' || ext === 'pdf';
  const isMarkdown = file.is_markdown || ext === 'md';
  const isCode = file.file_type === 'code' || ['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'sql', 'sh', 'yaml', 'yml', 'rs', 'go', 'cpp', 'c', 'java'].includes(ext);
  const isText = isMarkdown || isCode || ['txt', 'csv', 'log', 'env'].includes(ext);

  const mediaUrl = getMediaPreviewUrl(file.id);
  const textContent = fileDetail?.content || '';

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9500 }}>
      <div 
        className="modal-content trash-preview-modal-content modal-self-padded" 
        onClick={e => e.stopPropagation()} 
        style={{
          width: '94vw',
          maxWidth: '900px',
          height: '88vh',
          maxHeight: '850px',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)'
        }}
      >
        {/* 1. Trashed Warning Header Banner */}
        <div style={{
          background: 'rgba(239, 68, 68, 0.12)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
          padding: '0.6rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-rose)', fontSize: '0.82rem', fontWeight: 600 }}>
            <AlertTriangle size={16} />
            <span>휴지통에 보관 중인 항목입니다 (읽기 전용)</span>
            <span style={{ opacity: 0.75 }}>• {file.days_remaining}일 후 자동 영구 삭제</span>
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            삭제일시: {formatDate(file.trashed_at)}
          </span>
        </div>

        {/* 2. Modal Top Bar */}
        <div style={{
          padding: '0.85rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
          gap: '0.75rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: 1 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              {isImage ? <ImageIcon size={18} color="var(--accent-emerald)" /> :
               isVideo ? <Film size={18} color="var(--accent-purple)" /> :
               isAudio ? <Music size={18} color="var(--accent-amber)" /> :
               isPdf ? <FileText size={18} color="var(--accent-rose)" /> :
               isMarkdown ? <FileText size={18} color="var(--accent-primary)" /> :
               isCode ? <FileCode size={18} color="var(--accent-purple)" /> :
               <File size={18} color="var(--text-muted)" />}
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fileName}>
                {fileName}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '6px' }}>
                <span>{formatBytes(file.size_bytes)}</span>
                {file.folder_name && <span>• 원래 폴더: {file.folder_name}</span>}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            {/* Restore button */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onRestore(file)}
              disabled={isActionLoading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '0.4rem 0.8rem',
                fontSize: '0.82rem',
                color: 'var(--accent-emerald)',
                borderColor: 'rgba(16, 185, 129, 0.3)',
                background: 'rgba(16, 185, 129, 0.12)',
                fontWeight: 600,
                borderRadius: 'var(--radius-md)'
              }}
              title="원래 위치로 복구"
            >
              <RotateCcw size={14} />
              <span>복구</span>
            </button>

            {/* Permanent Delete button */}
            {canPurge && (
              <button
                type="button"
                className="btn-danger"
                onClick={() => onPermanentDelete(file)}
                disabled={isActionLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.82rem',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: 'var(--accent-rose)',
                  borderColor: 'rgba(239, 68, 68, 0.25)',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-md)'
                }}
                title="영구 삭제"
              >
                {isActionLoading ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                <span>영구 삭제</span>
              </button>
            )}

            <button
              type="button"
              className="btn-icon"
              onClick={onClose}
              title="닫기"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 3. Content Viewer Body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          background: 'var(--bg-primary)',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {isLoading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 10 }}>
              <Loader2 size={28} className="spin-anim" />
              <span>미리보기를 불러오는 중...</span>
            </div>
          ) : (
            <>
              {/* IMAGE VIEWER */}
              {isImage && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
                  {/* Image Controls Bar */}
                  <div style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    display: 'flex',
                    gap: 4,
                    background: 'rgba(0, 0, 0, 0.65)',
                    backdropFilter: 'blur(8px)',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-full)',
                    zIndex: 10
                  }}>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setZoomLevel(prev => Math.min(prev + 0.25, 3))}
                      title="확대"
                      style={{ color: '#fff', width: 26, height: 26 }}
                    >
                      <ZoomIn size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setZoomLevel(prev => Math.max(prev - 0.25, 0.5))}
                      title="축소"
                      style={{ color: '#fff', width: 26, height: 26 }}
                    >
                      <ZoomOut size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setRotation(prev => (prev + 90) % 360)}
                      title="90도 회전"
                      style={{ color: '#fff', width: 26, height: 26 }}
                    >
                      <RotateCw size={14} />
                    </button>
                  </div>

                  <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'auto',
                    padding: '1.5rem',
                    background: 'radial-gradient(circle, var(--bg-tertiary) 10%, transparent 11%)',
                    backgroundSize: '16px 16px'
                  }}>
                    <img
                      src={mediaUrl}
                      alt={fileName}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                        transition: 'transform 0.2s ease',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                        borderRadius: 'var(--radius-sm)'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* VIDEO VIEWER */}
              {isVideo && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: '#07090e', height: '100%' }}>
                  <VideoPlayer
                    src={mediaUrl}
                    file={file}
                    autoPlay={false}
                  />
                </div>
              )}

              {/* AUDIO VIEWER */}
              {isAudio && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: 20 }}>
                  <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Music size={40} color="var(--accent-amber)" />
                  </div>
                  <audio controls src={mediaUrl} style={{ width: '80%', maxWidth: 450 }} />
                </div>
              )}

              {/* PDF VIEWER */}
              {isPdf && (
                <div style={{ flex: 1, height: '100%' }}>
                  <iframe
                    src={mediaUrl}
                    title={fileName}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                </div>
              )}

              {/* MARKDOWN / TEXT / CODE VIEWER */}
              {isText && (
                <div style={{ padding: '1.5rem 2rem', overflowY: 'auto', flex: 1 }}>
                  {isMarkdown ? (
                    <div className="markdown-preview" style={{ lineHeight: 1.7 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {textContent || '*(내용이 비어있는 문서입니다)*'}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <pre style={{
                      margin: 0,
                      padding: '1rem',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      lineHeight: 1.6
                    }}>
                      <code>{textContent || '*(내용이 비어있는 문서입니다)*'}</code>
                    </pre>
                  )}
                </div>
              )}

              {/* OTHER BINARY FILES */}
              {!isImage && !isVideo && !isAudio && !isPdf && !isText && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', textAlign: 'center', gap: 16 }}>
                  <div style={{ width: 72, height: 72, borderRadius: 'var(--radius-lg)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <File size={36} color="var(--text-muted)" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                      {fileName}
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto' }}>
                      이 파일 형식은 휴지통 상태에서 직접 미리보기가 지원되지 않습니다.<br />
                      파일 내용을 확인하거나 사용하려면 먼저 <strong>복구</strong>를 진행해 주세요.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onRestore(file)}
                    style={{ marginTop: 8, flex: 'none' }}
                  >
                    <RotateCcw size={15} />
                    <span>원래 위치로 복구</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
