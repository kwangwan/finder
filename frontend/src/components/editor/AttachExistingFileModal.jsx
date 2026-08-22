import React, { useState, useEffect } from 'react';
import { Search, FileText, X, Plus } from '../../utils/icons';
import { listFiles } from '../../api';

// Lets the user pick a file already stored elsewhere in the workspace and
// insert a download-link card for it — distinct from BlockNote's own
// image/video/file upload blocks, which upload a NEW file. This one refers
// to an existing file the note doesn't own, so it's a plain download link +
// folder shortcut, not a note-owned media block (see NoteEditor.jsx's
// NOTE_MEDIA_FILE_ID_RE / delete_file cleanup, which deliberately skips
// links in this format).
export default function AttachExistingFileModal({ isOpen, onClose, onInsertMarkdown }) {
  const [files, setFiles] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      listFiles().then(setFiles).catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleInsertFile = (file) => {
    const folderId = file.folder_id || 'root';
    const snippet = `\n\n> 📦 **첨부 파일:** [📥 ${file.name} 다운로드](/api/storage/presigned-download/${file.id}) | [📁 저장된 폴더 바로가기](folder:${folderId})\n\n`;
    onInsertMarkdown(snippet);
    onClose();
  };

  const filteredFiles = files.filter(f =>
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.9rem 1.25rem'
        }}>
          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
            보관함 파일 첨부
          </span>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '1.25rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '0.45rem 0.75rem',
            marginBottom: '1rem'
          }}>
            <Search size={15} color="var(--text-muted)" />
            <input
              type="text"
              autoFocus
              placeholder="삽입할 파일 검색..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.875rem',
                width: '100%'
              }}
            />
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {filteredFiles.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                첨부 가능한 파일이 없습니다.
              </div>
            ) : (
              filteredFiles.map(f => (
                <div
                  key={f.id}
                  onClick={() => handleInsertFile(f)}
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-tertiary)',
                    marginBottom: '0.4rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    border: '1px solid transparent',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <FileText size={16} color="var(--accent-primary)" />
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {f.name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {f.file_type} • {Math.round(f.size_bytes / 1024)} KB
                      </div>
                    </div>
                  </div>

                  <button className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}>
                    <Plus size={13} />
                    <span>삽입</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
