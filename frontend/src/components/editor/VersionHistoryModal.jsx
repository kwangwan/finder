import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Clock, X, RotateCcw, Loader2 } from '../../utils/icons';
import { listFileVersions, getFileVersion, restoreFileVersion } from '../../api';
import { createMarkdownLinkComponents } from '../../utils/markdownLinkComponents';
import { useDialog } from '../../context/DialogContext';

function formatDate(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(isoString) {
  const d = new Date(isoString);
  // Seconds matter here: two versions closed out moments apart (e.g. an
  // idle-checkpoint close followed immediately by the next edit's open row)
  // are genuinely distinct entries, but without seconds they render as an
  // identical-looking HH:MM and look like a duplicate/bug at a glance.
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function groupByDate(versions) {
  const groups = [];
  let currentDate = null;
  let currentGroup = null;
  for (const v of versions) {
    const date = formatDate(v.created_at);
    if (date !== currentDate) {
      currentDate = date;
      currentGroup = { date, versions: [] };
      groups.push(currentGroup);
    }
    currentGroup.versions.push(v);
  }
  return groups;
}

export default function VersionHistoryModal({ fileId, isOpen, onClose, onRestored }) {
  const { showAlert, showConfirm } = useDialog();
  const [versions, setVersions] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null); // { id, name, editor_name, created_at, content } | null
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedVersion(null);
    setIsLoadingList(true);
    listFileVersions(fileId)
      .then(setVersions)
      .catch(() => setVersions([]))
      .finally(() => setIsLoadingList(false));
  }, [isOpen, fileId]);

  const handleSelectVersion = useCallback(async (version) => {
    setIsLoadingPreview(true);
    setSelectedVersion({ ...version, content: null });
    try {
      const full = await getFileVersion(fileId, version.id);
      setSelectedVersion(full);
    } catch (err) {
      await showAlert({ title: '불러오기 실패', message: '버전 내용을 불러오지 못했습니다: ' + err.message, type: 'error' });
      setSelectedVersion(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [fileId, showAlert]);

  const handleRestore = useCallback(async () => {
    if (!selectedVersion) return;
    const ok = await showConfirm({
      title: '이 버전으로 복원',
      message: `${formatDate(selectedVersion.created_at)} ${formatTime(selectedVersion.created_at)}에 저장된 내용으로 되돌립니다. 현재 내용은 복원 전에 히스토리에 자동으로 남습니다.`,
      type: 'warning',
      confirmText: '복원',
      cancelText: '취소'
    });
    if (!ok) return;
    setIsRestoring(true);
    try {
      const updatedFile = await restoreFileVersion(fileId, selectedVersion.id);
      onRestored(updatedFile);
      onClose();
    } catch (err) {
      await showAlert({ title: '복원 실패', message: '버전을 복원하지 못했습니다: ' + err.message, type: 'error' });
    } finally {
      setIsRestoring(false);
    }
  }, [fileId, selectedVersion, showConfirm, showAlert, onRestored, onClose]);

  if (!isOpen) return null;

  const groups = groupByDate(versions);
  const markdownLinkComponents = createMarkdownLinkComponents({ showAlert });

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1050 }}>
      <div
        className="modal-content version-history-modal modal-self-padded"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 720, width: '90vw', height: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={17} color="var(--accent-primary)" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>문서 히스토리</span>
          </div>
          <button className="btn-icon" onClick={onClose} title="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="version-history-body" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Version list */}
          <div className="version-history-list" style={{ width: 220, borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', flexShrink: 0 }}>
            {isLoadingList ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Loader2 size={16} className="spin" />
              </div>
            ) : groups.length === 0 ? (
              <div style={{ padding: '1.5rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                아직 저장된 이전 버전이 없습니다. 편집 후 시간이 지나면 자동으로 기록됩니다.
              </div>
            ) : (
              groups.map(group => (
                <div key={group.date}>
                  <div style={{ padding: '0.6rem 1rem 0.3rem', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                    {group.date}
                  </div>
                  {group.versions.map(v => (
                    <div
                      key={v.id}
                      onClick={() => handleSelectVersion(v)}
                      style={{
                        padding: '0.55rem 1rem',
                        cursor: 'pointer',
                        background: selectedVersion?.id === v.id ? 'var(--bg-tertiary)' : 'transparent',
                        borderLeft: selectedVersion?.id === v.id ? '2px solid var(--accent-primary)' : '2px solid transparent'
                      }}
                    >
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {formatTime(v.created_at)}
                        {v.is_open && (
                          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-sm)', padding: '0 4px' }}>
                            진행 중
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{v.editor_name || '알 수 없음'}</div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Preview pane */}
          <div className="version-history-preview" style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', minWidth: 0 }}>
            {!selectedVersion ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginTop: '2rem' }}>
                {/* No "왼쪽에서"/"위에서" direction wording — the list sits
                    left of this pane on desktop but above it on mobile
                    (.version-history-body switches to flex-direction:
                    column below 768px), so a direction-specific string would
                    be wrong on one of the two layouts. */}
                버전을 선택하면 그 시점의 내용을 볼 수 있습니다.
              </div>
            ) : isLoadingPreview || selectedVersion.content === null ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                <Loader2 size={18} className="spin" color="var(--accent-primary)" />
              </div>
            ) : (
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownLinkComponents}>
                  {selectedVersion.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '0.5rem',
          padding: '0.85rem 1.25rem', borderTop: '1px solid var(--border-subtle)'
        }}>
          <button className="btn-secondary" onClick={onClose}>닫기</button>
          <button
            className="btn-primary"
            onClick={handleRestore}
            disabled={!selectedVersion || isLoadingPreview || isRestoring}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {isRestoring ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
            <span>이 버전으로 복원</span>
          </button>
        </div>
      </div>
    </div>
  );
}
