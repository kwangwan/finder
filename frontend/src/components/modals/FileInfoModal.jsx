import React from 'react';
import { Info, X } from '../../utils/icons';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function FileInfoModal({ file, onClose }) {
  if (!file) return null;

  const isMarkdown = file.is_markdown || file.file_type === 'markdown';

  const rows = [
    { label: '종류', value: file.file_type },
    { label: '크기', value: formatBytes(file.size_bytes) },
    { label: '업로드한 사람', value: file.creator_name || '알 수 없음' },
  ];
  if (isMarkdown) {
    rows.push({ label: '최종 수정자', value: file.last_editor_name || '알 수 없음' });
  }
  rows.push({ label: '생성일', value: formatDate(file.created_at) });
  rows.push({ label: '수정일', value: formatDate(file.updated_at) });
  if (file.tags && file.tags.length > 0) {
    rows.push({ label: '태그', value: file.tags.join(', ') });
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1050 }}>
      <div
        className="modal-content"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 420, padding: '1.5rem', borderRadius: 'var(--radius-xl)' }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.1rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: 'rgba(59, 130, 246, 0.12)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
              flexShrink: 0
            }}>
              <Info size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                파일 정보
              </h3>
              <p style={{
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }} title={file.name}>
                {file.name}
              </p>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} title="닫기">
            <X size={17} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{r.label}</span>
              <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>{r.value}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <button className="btn-secondary" onClick={onClose} style={{ height: 36, padding: '0 1.1rem', fontSize: '0.82rem' }}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
