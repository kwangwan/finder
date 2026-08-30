import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, FileText, X, Plus, Image as ImageIcon, Video, Music, Loader2,
} from '../../utils/icons';
import { listFiles, getThumbnailUrl } from '../../api';

const KINDS = [
  { key: 'all', label: '전체' },
  { key: 'image', label: '이미지' },
  { key: 'video', label: '동영상' },
  { key: 'audio', label: '오디오' },
  { key: 'other', label: '문서 · 기타' },
];

function kindOf(file) {
  if (file.file_type === 'image' || file.file_type === 'video' || file.file_type === 'audio') return file.file_type;
  return 'other';
}

function iconFor(file) {
  if (file.file_type === 'image') return <ImageIcon size={16} color="var(--accent-primary)" />;
  if (file.file_type === 'video') return <Video size={16} color="var(--accent-primary)" />;
  if (file.file_type === 'audio') return <Music size={16} color="var(--accent-primary)" />;
  return <FileText size={16} color="var(--accent-primary)" />;
}

/**
 * Attach a file that is already stored here.
 *
 * It goes in as what it is — a picture as a picture, a video as a player, a
 * document as a file card — rather than as a download link for everything.
 * Nothing is uploaded or copied: the same file can be attached to as many
 * documents as it belongs in, and each document keeps its own link to it.
 */
export default function AttachExistingFileModal({ isOpen, onClose, onInsertFile, workspaceId }) {
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [kind, setKind] = useState('all');

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setSearchTerm('');
    listFiles(workspaceId ? { workspace_id: workspaceId } : undefined)
      .then((res) => setFiles(Array.isArray(res) ? res : (res?.items || [])))
      .catch(() => setFiles([]))
      .finally(() => setIsLoading(false));
  }, [isOpen, workspaceId]);

  const shown = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return files
      // A board has no content to embed, and a document attaching itself is
      // a loop nobody means.
      .filter((f) => f.file_type !== 'board' && !f.is_markdown && !f.is_trashed)
      .filter((f) => (kind === 'all' ? true : kindOf(f) === kind))
      .filter((f) => (term ? (f.name || '').toLowerCase().includes(term) : true))
      .slice(0, 200);
  }, [files, searchTerm, kind]);

  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 1500 }} onClick={onClose}>
      <div className="modal-content modal-self-padded at-modal" onClick={(e) => e.stopPropagation()}>
        <div className="at-head">
          <span className="at-title">파일 첨부</span>
          <button type="button" className="btn-icon" onClick={onClose} title="닫기"><X size={17} /></button>
        </div>

        <div className="at-tools">
          <span className="at-search">
            <Search size={15} color="var(--text-muted)" />
            <input
              type="text"
              autoFocus
              placeholder="이름으로 찾기"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </span>
          <span className="at-kinds">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                className={`at-kind ${kind === k.key ? 'on' : ''}`}
                onClick={() => setKind(k.key)}
              >
                {k.label}
              </button>
            ))}
          </span>
        </div>

        <div className="at-list">
          {isLoading ? (
            <div className="at-empty"><Loader2 size={16} className="spin" /><span>불러오는 중...</span></div>
          ) : shown.length === 0 ? (
            <div className="at-empty"><span>첨부할 수 있는 파일이 없습니다.</span></div>
          ) : shown.map((f) => (
            <button
              key={f.id}
              type="button"
              className="at-item"
              onClick={() => { onInsertFile?.(f); onClose(); }}
            >
              <span className="at-item-icon">
                {f.file_type === 'image' && f.thumbnail_s3_key
                  ? <img src={getThumbnailUrl(f.id)} alt="" />
                  : iconFor(f)}
              </span>
              <span className="at-item-body">
                <span className="at-item-name">{f.name}</span>
                <span className="at-item-meta">
                  {f.file_type} · {Math.max(1, Math.round((f.size_bytes || 0) / 1024))} KB
                </span>
              </span>
              <span className="at-item-add"><Plus size={13} /><span>첨부</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
