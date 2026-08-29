import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarCheck,
  Search,
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Folder as FolderIcon,
} from '../../utils/icons';
import { listWorkspaceTasks, getFileDetail } from '../../api';
import { PRIORITIES, STATUSES, dueTone, periodText, shortStamp, fullStamp } from './BoardPane';

const PAGE_SIZE = 30;

/**
 * Everything outstanding in this workspace, soonest deadline first.
 *
 * A board answers "what is in this project"; this answers "what do I have to
 * do", which is a question about the whole workspace and cannot be answered
 * from inside any one board. Completed work is left out by default — it is
 * not outstanding, and including it would bury what is.
 */
export default function ScheduleExplorer({ workspaceId, currentUser, onOpenBoard, refreshToken = 0 }) {
  const [data, setData] = useState({ items: [], total: 0, page: 1, total_pages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [includeDone, setIncludeDone] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');

  // Typing is debounced so a search does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { setPage(1); }, [includeDone, mineOnly, priority, status, workspaceId]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoading(true);
    try {
      const res = await listWorkspaceTasks({
        workspaceId,
        q: search,
        includeDone,
        assigneeId: mineOnly ? currentUser?.id : null,
        priority: priority || null,
        status: status || null,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(res);
      setError(null);
    } catch (e) {
      setError(e.message);
      setData({ items: [], total: 0, page: 1, total_pages: 1 });
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, search, includeDone, mineOnly, priority, status, page, currentUser?.id]);

  useEffect(() => { load(); }, [load, refreshToken]);

  const open = async (task) => {
    if (!task.board?.id) return;
    try {
      onOpenBoard?.(await getFileDetail(task.board.id));
    } catch (e) { /* the board was removed between listing and clicking */ }
  };

  const hasFilter = !!(search || includeDone || mineOnly || priority || status);

  return (
    <div className="schedule-explorer">
      <div className="schedule-head">
        <div className="schedule-title">
          <CalendarCheck size={18} color="var(--accent-primary)" />
          <h2>일정</h2>
          <span className="schedule-count">{data.total}건</span>
        </div>
        <button type="button" className="btn-secondary" onClick={load} disabled={isLoading}>
          <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
          <span className="hide-mobile">새로고침</span>
        </button>
      </div>

      <div className="schedule-filters">
        <div className="folder-search-box schedule-search">
          <Search size={14} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="작업 이름 검색..."
            aria-label="작업 검색"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} title="검색어 지우기"><X size={13} /></button>
          )}
        </div>

        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="중요도로 거르기">
          <option value="">중요도 전체</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="진행 상태로 거르기">
          <option value="">상태 전체</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <button
          type="button"
          className={`schedule-toggle ${mineOnly ? 'on' : ''}`}
          onClick={() => setMineOnly((v) => !v)}
        >
          내 작업만
        </button>
        <button
          type="button"
          className={`schedule-toggle ${includeDone ? 'on' : ''}`}
          onClick={() => setIncludeDone((v) => !v)}
        >
          완료 포함
        </button>
      </div>

      {isLoading && data.items.length === 0 ? (
        <div className="board-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>
      ) : error ? (
        <div className="board-empty"><span>{error}</span></div>
      ) : data.items.length === 0 ? (
        <div className="schedule-empty">
          <CalendarCheck size={28} color="var(--text-muted)" />
          <h3>{hasFilter ? '조건에 맞는 작업이 없습니다' : '아직 등록된 작업이 없습니다'}</h3>
          <p>
            {hasFilter
              ? '검색어나 필터를 바꿔 보세요.'
              : '폴더에서 ‘새 일정’을 만들고 작업을 추가하면 여기에 모입니다.'}
          </p>
        </div>
      ) : (
        <div className="schedule-list">
          {data.items.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`schedule-item ${task.status === 'done' ? 'is-done' : ''}`}
              onClick={() => open(task)}
              title="이 작업이 있는 일정 열기"
            >
              <span className="schedule-top">
                <span className="schedule-name">{task.name}</span>
                <span className={`board-chip priority-${task.priority} is-static`}>{task.priority_label}</span>
                <span className={`board-chip status-${task.status} is-static`}>{task.status_label}</span>
              </span>
              <span className="schedule-meta">
                <span className={`schedule-due due-${dueTone(task.days_left, task.status)}`}>
                  {task.start_date || task.due_date
                    ? periodText(task.start_date, task.due_date, task.days_left)
                    : '기간 없음'}
                </span>
                <span className="schedule-where">
                  <FolderIcon size={11} />
                  {task.board?.name || '(삭제된 일정)'}
                </span>
                <span className="schedule-people">
                  {task.assignees.length === 0
                    ? <span className="board-muted">작업자 없음</span>
                    : task.assignees.map((a) => <span key={a.id} className="board-person">{a.name}</span>)}
                </span>
                <span className="board-meta-stamp" title={`만든 날 ${fullStamp(task.created_at)}`}>만듦 {shortStamp(task.created_at)}</span>
                <span className="board-meta-stamp" title={`마지막 수정 ${fullStamp(task.updated_at)}`}>수정 {shortStamp(task.updated_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {data.total_pages > 1 && (
        <div className="folder-pager">
          <button type="button" className="btn-secondary" disabled={page <= 1 || isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft size={14} />
            <span className="hide-mobile">이전</span>
          </button>
          <span className="folder-pager-status">{page} / {data.total_pages}</span>
          <button type="button" className="btn-secondary" disabled={page >= data.total_pages || isLoading} onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}>
            <span className="hide-mobile">다음</span>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
