import React, { useState, useEffect } from 'react';
import { 
  Paperclip, 
  Video, 
  Search, 
  FileText, 
  Download, 
  Folder, 
  X, 
  Plus, 
  ExternalLink 
} from '../../utils/icons';
import { listFiles } from '../../api';

export default function InsertFileModal({
  isOpen,
  onClose,
  onInsertMarkdown
}) {
  const [activeTab, setActiveTab] = useState('files'); // 'files' | 'youtube'
  const [files, setFiles] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');

  useEffect(() => {
    if (isOpen && activeTab === 'files') {
      listFiles().then(setFiles).catch(console.error);
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleInsertFile = (file) => {
    // Markdown link with special format for custom renderer
    const folderId = file.folder_id || 'root';
    const snippet = `\n\n> 📦 **첨부 파일:** [📥 ${file.name} 다운로드](/api/storage/presigned-download/${file.id}) | [📁 저장된 폴더 바로가기](folder:${folderId})\n\n`;
    onInsertMarkdown(snippet);
    onClose();
  };

  const handleInsertYoutube = (e) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;

    const url = youtubeUrl.trim();
    const snippet = `\n\n${url}\n\n`;
    onInsertMarkdown(snippet);
    setYoutubeUrl('');
    onClose();
  };

  const filteredFiles = files.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
        {/* Tab Header */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle)',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1rem'
        }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setActiveTab('files')}
              style={{
                padding: '0.9rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'files' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'files' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Paperclip size={15} />
              <span>보관함 파일 첨부</span>
            </button>

            <button
              onClick={() => setActiveTab('youtube')}
              style={{
                padding: '0.9rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'youtube' ? '2px solid var(--accent-rose)' : '2px solid transparent',
                color: activeTab === 'youtube' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Video size={16} color="var(--accent-rose)" />
              <span>유튜브 동영상 임베드</span>
            </button>
          </div>

          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Tab 1: Files List */}
        {activeTab === 'files' && (
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
        )}

        {/* Tab 2: YouTube Embed */}
        {activeTab === 'youtube' && (
          <form onSubmit={handleInsertYoutube} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
                YouTube 동영상 URL
              </label>
              <input
                type="url"
                autoFocus
                required
                value={youtubeUrl}
                onChange={e => setYoutubeUrl(e.target.value)}
                placeholder="예: https://www.youtube.com/watch?v=dQw4w9WgXcQ 또는 https://youtu.be/..."
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.6rem 0.8rem',
                  fontSize: '0.9rem',
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              />
            </div>

            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              💡 마크다운 문서 내에 유튜브 동영상 URL을 입력하면 자동으로 반응형 플레이어가 생성됩니다.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn-secondary" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="btn-primary" disabled={!youtubeUrl.trim()}>
                동영상 삽입
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
