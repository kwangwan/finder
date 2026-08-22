import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Sparkles, 
  FileText, 
  Folder, 
  X, 
  ArrowRight, 
  CornerDownLeft, 
  SlidersHorizontal,
  Clock,
  Calendar,
  User,
  Filter,
  Layers,
  Table,
  Image as ImageIcon,
  Film
} from '../../utils/icons';
import { searchDocuments } from '../../api';
import Select from '../common/Select';

// Helper to flatten nested folder tree for dropdown options with indentations
function flattenFolderTree(nodeList, depth = 0) {
  let result = [];
  for (const node of (nodeList || [])) {
    const indent = '\u00A0\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '└ ' : '');
    result.push({
      id: node.id,
      name: node.name,
      displayName: `${indent}${node.name}`,
      depth
    });
    if (node.children && node.children.length > 0) {
      result = result.concat(flattenFolderTree(node.children, depth + 1));
    }
  }
  return result;
}

const FILE_TYPE_FILTERS = [
  { id: '', label: '모든 형식' },
  { id: 'note', label: '문서', icon: FileText },
  { id: 'pdf', label: 'PDF 문서', icon: FileText },
  { id: 'docx', label: '워드 (.docx)', icon: FileText },
  { id: 'xlsx', label: '엑셀 (.xlsx)', icon: Table },
  { id: 'image', label: '이미지', icon: ImageIcon },
  { id: 'video', label: '동영상', icon: Film },
];

const DATE_PRESETS = [
  { id: 'all', label: '전체 기간' },
  { id: '7d', label: '최근 7일' },
  { id: '30d', label: '최근 30일' },
  { id: '90d', label: '최근 90일' },
];

export default function SemanticSearchModal({
  isOpen,
  onClose,
  activeWorkspaceId,
  onSelectResult,
  folders = []
}) {
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState('');
  const [fileType, setFileType] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [minSimilarity, setMinSimilarity] = useState(0.2);
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showOptions, setShowOptions] = useState(false);

  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus on open & reset
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  const getDateRange = (preset) => {
    if (preset === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return d.toISOString();
    } else if (preset === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString();
    } else if (preset === '90d') {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return d.toISOString();
    }
    return null;
  };

  // Handle Search API
  const performSearch = async (searchQuery, targetFolder, targetType, targetDatePreset, simThreshold) => {
    if (!searchQuery || !searchQuery.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const startDate = getDateRange(targetDatePreset);

      const data = await searchDocuments({
        query: searchQuery.trim(),
        workspace_id: activeWorkspaceId || null,
        folder_id: targetFolder || null,
        file_type: targetType || null,
        start_date: startDate,
        min_similarity: simThreshold,
        limit: 15
      });
      setResults(data.results || []);
      setDurationMs(data.duration_ms || 0);
      setSelectedIndex(0);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch(val, folderId, fileType, datePreset, minSimilarity);
    }, 200);
  };

  const handleFilterChange = (newFolder, newType, newPreset, newSim) => {
    setFolderId(newFolder);
    setFileType(newType);
    setDatePreset(newPreset);
    setMinSimilarity(newSim);
    performSearch(query, newFolder, newType, newPreset, newSim);
  };

  // Keyboard navigation (Arrow keys + Enter)
  const handleKeyDown = (e) => {
    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        onSelectResult(results[selectedIndex]);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 680,
          padding: 0,
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        {/* Search Input Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-primary)'
        }}>
          <Sparkles size={20} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            className="editor-title-input"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="AI 시맨틱 의미 검색 및 키워드 검색... (예: '예산 계획', '아키텍처')"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '1rem',
              color: 'var(--text-primary)',
              fontWeight: 500
            }}
          />
          {query && (
            <button className="btn-icon" onClick={() => { setQuery(''); setResults([]); }}>
              <X size={16} />
            </button>
          )}
          <button 
            className={`btn-icon ${showOptions ? 'active' : ''}`}
            onClick={() => setShowOptions(prev => !prev)}
            title="고급 필터 옵션"
            style={{ color: showOptions ? 'var(--accent-primary)' : 'var(--text-muted)' }}
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>

        {/* Advanced Filters Toolbar */}
        {showOptions && (
          <div style={{
            padding: '0.85rem 1.25rem',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.65rem'
          }}>
            {/* Filter Row 1: File Type & Folder */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  문서/파일 형식
                </label>
                <Select
                  value={fileType}
                  onChange={(v) => handleFilterChange(folderId, v, datePreset, minSimilarity)}
                  options={FILE_TYPE_FILTERS.map(f => ({ value: f.id, label: f.label }))}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  폴더 범위
                </label>
                <Select
                  value={folderId}
                  onChange={(v) => handleFilterChange(v, fileType, datePreset, minSimilarity)}
                  options={[
                    { value: '', label: '(전체 폴더)' },
                    ...flattenFolderTree(folders).map(f => ({ value: f.id, label: f.displayName })),
                  ]}
                />
              </div>
            </div>

            {/* Filter Row 2: Date Presets & Similarity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', alignItems: 'center' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  생성/수정 기간
                </label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {DATE_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleFilterChange(folderId, fileType, p.id, minSimilarity)}
                      style={{
                        flex: 1,
                        padding: '0.3rem',
                        fontSize: '0.75rem',
                        fontWeight: datePreset === p.id ? 700 : 500,
                        backgroundColor: datePreset === p.id ? 'var(--accent-primary)' : 'var(--bg-card)',
                        color: datePreset === p.id ? '#fff' : 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 4,
                        cursor: 'pointer'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>
                  <span>유사도 임계값</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{Math.round(minSimilarity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="0.8"
                  step="0.05"
                  value={minSimilarity}
                  onChange={e => handleFilterChange(folderId, fileType, datePreset, parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Results List */}
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: '0.5rem 0' }}>
          {isLoading && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              지식 검색 중...
            </div>
          )}

          {!isLoading && query && results.length === 0 && (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Search size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                일치하는 지식 결과가 없습니다
              </div>
              <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                다른 검색어를 입력하거나 필터 옵션을 변경해보세요.
              </div>
            </div>
          )}

          {!isLoading && results.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            const simPercent = Math.round(item.similarity_score * 100);

            return (
              <div
                key={item.file_id}
                onClick={() => {
                  onSelectResult(item);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  padding: '0.75rem 1.25rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.85rem',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                  borderLeft: isSelected ? '3px solid var(--accent-primary)' : '3px solid transparent',
                  transition: 'background 0.15s ease'
                }}
              >
                <div style={{
                  padding: '0.45rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-tertiary)',
                  marginTop: 2
                }}>
                  <FileText size={16} color={isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        {item.file_name}
                      </span>
                      {item.folder_name && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Folder size={11} /> {item.folder_name}
                        </span>
                      )}
                      {item.author_name && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
                          <User size={11} /> {item.author_name}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                      {item.matched_chunks_count > 1 && (
                        <span style={{
                          fontSize: '0.68rem',
                          color: 'var(--text-muted)',
                          padding: '0.1rem 0.35rem',
                          backgroundColor: 'var(--bg-tertiary)',
                          borderRadius: 'var(--radius-sm)'
                        }}>
                          관련 문맥 {item.matched_chunks_count}곳
                        </span>
                      )}
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: item.match_type === 'semantic' 
                          ? 'rgba(139, 92, 246, 0.2)' 
                          : item.match_type === 'hybrid'
                          ? 'rgba(59, 130, 246, 0.2)'
                          : 'rgba(16, 185, 129, 0.2)',
                        color: item.match_type === 'semantic' 
                          ? '#a78bfa' 
                          : item.match_type === 'hybrid'
                          ? '#60a5fa'
                          : '#34d399'
                      }}>
                        {item.match_type === 'semantic' 
                          ? `${simPercent}% 유사` 
                          : item.match_type === 'hybrid'
                          ? `${simPercent}% 하이브리드`
                          : '키워드'}
                      </span>
                    </div>
                  </div>

                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.4,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical'
                  }}>
                    {item.matched_snippet}
                  </div>
                </div>

                {isSelected && (
                  <CornerDownLeft size={14} color="var(--accent-primary)" style={{ marginTop: 4, flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer Meta */}
        <div style={{
          padding: '0.65rem 1.25rem',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-primary)',
          fontSize: '0.72rem',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            {results.length > 0 ? (
              <span>총 <strong>{results.length}</strong>개 결과 ({durationMs}ms)</span>
            ) : (
              <span>↑↓ 이동 · ↵ 선택 · ESC 닫기</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span>AI 시맨틱 & 키워드 검색</span>
          </div>
        </div>
      </div>
    </div>
  );
}
