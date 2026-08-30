import React, { useState } from 'react';
import UsernameHistoryModal from './UsernameHistoryModal';
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
  // Which person's handle history is open, if any. The handle is how work is
  // attributed here, so it is a link to the record of what it used to be.
  const [historyUserId, setHistoryUserId] = useState(null);

  if (!file) return null;

  const isMarkdown = file.is_markdown;

  // One person, written as one thing. "@jhkim · 김지현" read as two people
  // separated by a dot, which is exactly what a middle dot means everywhere
  // else in this app — so the name leads and the handle qualifies it.
  const who = (handle, name) => {
    if (!handle && !name) return '알 수 없음';
    if (!handle) return name;
    if (!name || name === handle) return `@${handle}`;
    return `${name} (@${handle})`;
  };

  const person = (handle, name, userId) => (
    userId ? (
      <button type="button" className="fi-person" onClick={() => setHistoryUserId(userId)} title="아이디 변경 이력 보기">
        {who(handle, name)}
      </button>
    ) : who(handle, name)
  );

  const rows = [
    { label: '종류', value: isMarkdown ? '문서' : (file.file_type ? file.file_type.toUpperCase() : '-') },
    { label: '크기', value: formatBytes(file.size_bytes) },
    { label: '업로드한 사람', value: person(file.creator_name, file.creator_display_name, file.created_by) },
  ];
  if (isMarkdown) {
    rows.push({
      label: '최종 수정자',
      value: person(file.last_editor_name, file.last_editor_display_name, file.last_edited_by),
    });
  }
  rows.push({ label: '생성일', value: formatDate(file.created_at) });
  rows.push({ label: '수정일', value: formatDate(file.updated_at) });

  // Capture metadata read out of the file itself. Only camera-produced media
  // has any — screenshots and screen recordings genuinely carry none — so
  // each row appears only when that value actually exists, rather than
  // padding the panel with "-" for files that can never have it.
  if (file.taken_at) {
    rows.push({ label: '촬영일시', value: formatDate(file.taken_at) });
  }
  if (file.camera_make || file.camera_model) {
    rows.push({
      label: '촬영 기기',
      // Samsung writes Make "samsung" and Model "Galaxy S26+", so the two
      // read as one device name; other makers repeat the brand in the model
      // ("Canon" / "Canon EOS R5"), where joining would stutter.
      value: [file.camera_make, file.camera_model]
        .filter(Boolean)
        .filter((part, i, all) => i === 0 || !all[0] || !part.toLowerCase().startsWith(all[0].toLowerCase()))
        .join(' '),
    });
  }
  if (file.media_width && file.media_height) {
    rows.push({ label: '해상도', value: `${file.media_width} × ${file.media_height}` });
  }
  if (typeof file.gps_latitude === 'number' && typeof file.gps_longitude === 'number') {
    rows.push({
      label: '촬영 위치',
      value: `${file.gps_latitude.toFixed(6)}, ${file.gps_longitude.toFixed(6)}`,
      href: `https://www.google.com/maps/search/?api=1&query=${file.gps_latitude},${file.gps_longitude}`,
      hrefLabel: '지도에서 보기',
    });
  }

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
                overflowWrap: 'break-word',
                wordBreak: 'break-word'
              }}>
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
              <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                {r.value}
              </span>
              {r.href && (
                // Its own line rather than trailing the value: coordinates are
                // long enough that the two together wrap awkwardly, and the
                // link reads as an action rather than part of the value.
                <a
                  href={r.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--accent-primary)',
                    whiteSpace: 'nowrap',
                    marginTop: '0.15rem',
                    alignSelf: 'flex-start',
                  }}
                >
                  {r.hrefLabel}
                </a>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <button className="btn-secondary" onClick={onClose} style={{ height: 36, padding: '0 1.1rem', fontSize: '0.82rem' }}>
            닫기
          </button>
        </div>
      </div>

      <UsernameHistoryModal
        userId={historyUserId}
        isOpen={!!historyUserId}
        onClose={() => setHistoryUserId(null)}
      />
    </div>
  );
}
