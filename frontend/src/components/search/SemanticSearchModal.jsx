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
  Film,
  AlertCircle
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

// `semanticSupported: false` marks a type whose contents are never embedded
// — nothing is extracted from an image or a video, so there is nothing for
// meaning-based matching to work against and only the file name can match.
// The UI says so outright rather than letting the user assume an empty
// result means "no such content exists".
const FILE_TYPE_FILTERS = [
  { id: '', label: '모든 형식' },
  { id: 'note', label: '문서', icon: FileText },
  { id: 'pdf', label: 'PDF 문서', icon: FileText },
  { id: 'docx', label: '워드 (.docx)', icon: FileText },
  { id: 'xlsx', label: '엑셀 (.xlsx)', icon: Table },
  { id: 'image', label: '이미지 (이름만 검색)', icon: ImageIcon, semanticSupported: false },
  { id: 'video', label: '동영상 (이름만 검색)', icon: Film, semanticSupported: false },
];

const NAME_ONLY_FILE_TYPES = FILE_TYPE_FILTERS
  .filter(f => f.semanticSupported === false)
  .map(f => f.id);

// Results load a page at a time as the list is scrolled. Kept modest so the
// first page renders fast — a broad filename query can match thousands of
// files, and dumping all of them into the modal at once is both slow and
// unusable.
const PAGE_SIZE = 30;

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
  const [totalResults, setTotalResults] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const resultsScrollRef = useRef(null);
  const sentinelRef = useRef(null);
  // The search parameters the currently-displayed results came from. Held in
  // a ref so the scroll observer can load the next page without being torn
  // down and rebuilt every time a filter changes.
  const activeSearchRef = useRef(null);
  // Guards against the observer firing again for the same page while a fetch
  // is already in flight (state updates lag the scroll events).
  const isFetchingRef = useRef(false);
  // How many results the server has returned so far for the active
  // search — the offset for the next page. Kept separate from
  // results.length, which can lag it when de-duplication drops rows.
  const nextOffsetRef = useRef(0);

  // Focus on open & reset
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
      setResults([]);
      setTotalResults(0);
      setHasMore(false);
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
      activeSearchRef.current = null;
      setResults([]);
      setTotalResults(0);
      setHasMore(false);
      setIsLoading(false);
      return;
    }

    const criteria = {
      query: searchQuery.trim(),
      workspace_id: activeWorkspaceId || null,
      folder_id: targetFolder || null,
      file_type: targetType || null,
      start_date: getDateRange(targetDatePreset),
      min_similarity: simThreshold
    };
    activeSearchRef.current = criteria;
    nextOffsetRef.current = 0;

    isFetchingRef.current = true;
    setIsLoading(true);
    try {
      const data = await searchDocuments({ ...criteria, limit: PAGE_SIZE, offset: 0 });
      // A slower earlier request must not overwrite the results of a newer
      // one — the query box is debounced, not serialised.
      if (activeSearchRef.current !== criteria) return;
      const firstPage = data.results || [];
      nextOffsetRef.current = firstPage.length;
      setResults(firstPage);
      setTotalResults(data.total_results || 0);
      setHasMore(!!data.has_more);
      setDurationMs(data.duration_ms || 0);
      setSelectedIndex(0);
      resultsScrollRef.current?.scrollTo({ top: 0 });
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      if (activeSearchRef.current === criteria) setIsLoading(false);
      isFetchingRef.current = false;
    }
  };

  // Fetch the next page and append. Called by the scroll observer below.
  const loadMore = async () => {
    const criteria = activeSearchRef.current;
    if (!criteria || isFetchingRef.current) return;

    isFetchingRef.current = true;
    setIsLoadingMore(true);
    try {
      // Offset counts what the SERVER has handed over, not how many rows
      // survived de-duplication into the list. Deriving it from
      // results.length meant that whenever a page overlapped the previous
      // one, the next request asked for a range it had already seen —
      // re-requesting the same rows forever while the list stopped growing.
      const offset = nextOffsetRef.current;
      const data = await searchDocuments({ ...criteria, limit: PAGE_SIZE, offset });
      if (activeSearchRef.current !== criteria) return; // filters changed mid-flight
      const incoming = data.results || [];
      nextOffsetRef.current = offset + incoming.length;

      // Count the new rows HERE, against the results this closure already
      // has — not inside the setResults updater below. The updater does not
      // run until React commits, which is after this function has already
      // read the count, so doing it there always saw 0 and made the very
      // first appended page look like it had added nothing: hasMore went
      // false and the list stopped dead at 60 of 200.
      const seen = new Set(results.map(r => r.file_id));
      const addedCount = incoming.filter(r => !seen.has(r.file_id)).length;

      setResults(prev => {
        // Defensive de-dupe: appending blind would duplicate rows if a page
        // ever overlapped, and React would then warn on duplicate keys.
        const prevSeen = new Set(prev.map(r => r.file_id));
        const fresh = incoming.filter(r => !prevSeen.has(r.file_id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      setTotalResults(data.total_results || 0);
      // Stop when the server says so, when it returned nothing, or when a
      // full page contributed no new rows — that last case means the ranking
      // is no longer advancing, and continuing would spin the observer
      // against an unchanging list.
      setHasMore(!!data.has_more && incoming.length > 0 && addedCount > 0);
    } catch (err) {
      console.error('Search load-more error:', err);
      setHasMore(false); // don't let a failed page spin forever
    } finally {
      if (activeSearchRef.current === criteria) setIsLoadingMore(false);
      isFetchingRef.current = false;
    }
  };

  // Auto-load the next page when the sentinel scrolls into the results
  // viewport. `root` is the results container, not the page — the list has
  // its own scrollbar, so a viewport-relative observer would fire on the
  // wrong element (or immediately, since the sentinel sits inside a short
  // scrollable box that is itself fully on screen). rootMargin starts the
  // fetch slightly before the sentinel is actually visible so the next page
  // is usually already in place by the time the user reaches the bottom.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = resultsScrollRef.current;
    if (!sentinel || !root || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) loadMore();
      },
      { root, rootMargin: '150px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // results.length is a dependency because loadMore derives the next
    // offset from it — without it the observer would keep re-requesting the
    // same page after the first append.
  }, [hasMore, results.length, isLoadingMore]);

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
    // Escape is handled before the "no results" guard below. It used to sit
    // after it, so pressing Escape with an empty box — or on a query that
    // matched nothing, exactly when someone most wants out — hit the early
    // return and the modal refused to close.
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

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
    }
  };

  // ...and again at the window level, because the handler above only fires
  // while the search input holds focus. Clicking a filter dropdown, the
  // results list, or anywhere else in the modal moved focus off the input
  // and left Escape doing nothing at all.
  useEffect(() => {
    if (!isOpen) return;
    const onWindowKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [isOpen, onClose]);

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
                {NAME_ONLY_FILE_TYPES.includes(fileType) && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 5,
                    marginTop: 6,
                    fontSize: '0.72rem',
                    lineHeight: 1.4,
                    color: 'var(--accent-amber)'
                  }}>
                    <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>이 형식은 아직 의미 기반 검색을 지원하지 않습니다. 파일 이름으로만 찾을 수 있습니다.</span>
                  </div>
                )}
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
        <div ref={resultsScrollRef} style={{ maxHeight: 380, overflowY: 'auto', padding: '0.5rem 0' }}>
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
                          : item.match_type === 'filename'
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(16, 185, 129, 0.2)',
                        color: item.match_type === 'semantic'
                          ? '#a78bfa'
                          : item.match_type === 'hybrid'
                          ? '#60a5fa'
                          : item.match_type === 'filename'
                          ? '#fbbf24'
                          : '#34d399'
                      }}>
                        {item.match_type === 'semantic'
                          ? `${simPercent}% 유사`
                          : item.match_type === 'hybrid'
                          ? `${simPercent}% 하이브리드`
                          : item.match_type === 'filename'
                          ? '파일 이름'
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

          {/* Infinite scroll sentinel — the observer below loads the next
              page as soon as this scrolls into view. Rendered only while
              more results exist, so reaching the true end simply stops. */}
          {!isLoading && hasMore && (
            <div
              ref={sentinelRef}
              style={{
                padding: '0.85rem',
                textAlign: 'center',
                fontSize: '0.75rem',
                color: 'var(--text-muted)'
              }}
            >
              {isLoadingMore ? '더 불러오는 중...' : ''}
            </div>
          )}

          {!isLoading && !hasMore && results.length > 0 && totalResults > PAGE_SIZE && (
            <div style={{ padding: '0.85rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              모든 결과를 표시했습니다
            </div>
          )}
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
              // Show how many of the real total are on screen — the total is
              // now counted independently of what was fetched, so it no
              // longer changes just because more results were loaded.
              results.length < totalResults ? (
                <span>총 <strong>{totalResults}</strong>개 중 <strong>{results.length}</strong>개 표시 ({durationMs}ms)</span>
              ) : (
                <span>총 <strong>{totalResults}</strong>개 결과 ({durationMs}ms)</span>
              )
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
