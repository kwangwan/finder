import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck, Search, X, Loader2, ChevronLeft, ChevronRight, RefreshCw, Settings,
  Folder as FolderIcon,
} from '../../utils/icons';
import { listWorkspaceTasks, updateBoardTask, deleteBoardTask, getFileDetail, getBoard } from '../../api';
import { useDialog } from '../../context/DialogContext';
import TaskRow from './TaskRow';
import TaskDetailDrawer from './TaskDetailDrawer';
import DigestSettingsModal from './DigestSettingsModal';

const PAGE_SIZE = 40;

const GROUPINGS = [
  { value: 'urgency', label: '기한순' },
  { value: 'board', label: '일정별' },
  { value: 'status', label: '상태별' },
];

/**
 * Everything in this workspace, managed in one place.
 *
 * Not a notification list: a task here is edited exactly as it is on its own
 * board — the same row, the same controls, the same detail drawer — because
 * "what do I have to do" and "let me deal with it" are the same sitting.
 * A board answers "what is in this project"; this answers the question that
 * spans all of them, which no single board can.
 */
export default function ScheduleExplorer({
  workspaceId, workspaceName = '', currentUser, onOpenBoard, refreshToken = 0,
}) {
  const { showConfirm, showAlert } = useDialog();
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
  const [grouping, setGrouping] = useState('urgency');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openTask, setOpenTask] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Who may be assigned differs per board (the shared workspace allows only
  // yourself), so it is fetched for the board a task actually belongs to.
  const [peopleByBoard, setPeopleByBoard] = useState({});

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

  // Fetched once per board that appears on the page, not per row.
  useEffect(() => {
    const missing = [...new Set(data.items.map((t) => t.board?.id).filter(Boolean))]
      .filter((id) => !(id in peopleByBoard));
    if (missing.length === 0) return undefined;
    let cancelled = false;
    Promise.all(missing.map((id) => getBoard(id).then((b) => [id, b.assignable_users || []]).catch(() => [id, []])))
      .then((pairs) => { if (!cancelled) setPeopleByBoard((prev) => ({ ...prev, ...Object.fromEntries(pairs) })); });
    return () => { cancelled = true; };
  }, [data.items, peopleByBoard]);

  const patch = async (task, payload) => {
    setBusyId(task.id);
    try {
      const updated = await updateBoardTask(task.file_id, task.id, payload);
      setData((prev) => ({
        ...prev,
        items: prev.items.map((t) => (t.id === task.id ? { ...t, ...updated, board: t.board } : t)),
      }));
      setOpenTask((prev) => (prev && prev.id === task.id ? { ...prev, ...updated, board: prev.board } : prev));
    } catch (e) {
      await showAlert({ title: '저장하지 못했습니다', message: e.message, type: 'error' });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const removeTask = async (task) => {
    const confirmed = await showConfirm({
      title: '작업 삭제',
      message: `'${task.name}' 작업을 삭제하시겠습니까?\n하위 작업이 있다면 함께 지워지며, 휴지통을 거치지 않습니다.`,
      confirmText: '삭제',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteBoardTask(task.file_id, task.id);
      setData((prev) => ({ ...prev, items: prev.items.filter((t) => t.id !== task.id), total: prev.total - 1 }));
      if (openTask?.id === task.id) setOpenTask(null);
    } catch (e) {
      await showAlert({ title: '삭제하지 못했습니다', message: e.message, type: 'error' });
    }
  };

  const openBoard = async (task) => {
    if (!task.board?.id) return;
    try { onOpenBoard?.(await getFileDetail(task.board.id)); } catch (e) { /* removed since listing */ }
  };

  /**
   * The page split into labelled groups.
   *
   * Ordered so the first heading is always the one to read first. The server
   * already returns the page in urgency order, so grouping never reorders
   * anything within a group.
   */
  const groups = useMemo(() => {
    const items = data.items;
    if (grouping === 'board') {
      const map = new Map();
      items.forEach((t) => {
        const key = t.board?.id || 'none';
        if (!map.has(key)) map.set(key, { key, label: t.board?.name || '(삭제된 일정)', items: [] });
        map.get(key).items.push(t);
      });
      return [...map.values()];
    }
    if (grouping === 'status') {
      const order = ['todo', 'in_progress', 'review', 'hold', 'done'];
      const labels = { todo: '대기', in_progress: '진행 중', review: '검토', hold: '보류', done: '완료' };
      return order
        .map((s) => ({ key: s, label: labels[s], items: items.filter((t) => t.status === s) }))
        .filter((g) => g.items.length);
    }
    const buckets = [
      { key: 'overdue', label: '기한 지남', test: (t) => t.days_left !== null && t.days_left < 0 },
      { key: 'today', label: '오늘', test: (t) => t.days_left === 0 },
      { key: 'week', label: '7일 이내', test: (t) => t.days_left > 0 && t.days_left <= 7 },
      { key: 'month', label: '30일 이내', test: (t) => t.days_left > 7 && t.days_left <= 30 },
      { key: 'later', label: '그 이후', test: (t) => t.days_left > 30 },
      { key: 'none', label: '기간 없음', test: (t) => t.days_left === null || t.days_left === undefined },
    ];
    return buckets
      .map((b) => ({ key: b.key, label: b.label, items: items.filter(b.test) }))
      .filter((g) => g.items.length);
  }, [data.items, grouping]);

  const hasFilter = !!(search || includeDone || mineOnly || priority || status);

  return (
    <div className="sc-explorer">
      <div className="sc-head">
        <div className="sc-title">
          <CalendarCheck size={18} color="var(--accent-primary)" />
          <h2>일정</h2>
          <span className="sc-count">{data.total}건</span>
        </div>
        <div className="sc-head-actions">
          <button type="button" className="btn-secondary" onClick={() => setSettingsOpen(true)} title="일정 알림 설정">
            <Settings size={14} />
            <span className="hide-mobile">알림 설정</span>
          </button>
          <button type="button" className="btn-secondary" onClick={load} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
            <span className="hide-mobile">새로고침</span>
          </button>
        </div>
      </div>

      <div className="sc-filters">
        <div className="folder-search-box sc-search">
          <Search size={14} />
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="작업 이름 검색..." aria-label="작업 검색"
          />
          {query && <button type="button" onClick={() => setQuery('')} title="검색어 지우기"><X size={13} /></button>}
        </div>

        <div className="sc-groupby" role="group" aria-label="묶는 기준">
          {GROUPINGS.map((g) => (
            <button
              key={g.value}
              type="button"
              className={grouping === g.value ? 'on' : ''}
              onClick={() => setGrouping(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="중요도로 거르기">
          <option value="">중요도 전체</option>
          <option value="urgent">긴급</option><option value="high">높음</option>
          <option value="normal">보통</option><option value="low">낮음</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="진행 상태로 거르기">
          <option value="">상태 전체</option>
          <option value="todo">대기</option><option value="in_progress">진행 중</option>
          <option value="review">검토</option><option value="done">완료</option><option value="hold">보류</option>
        </select>

        <button type="button" className={`sc-toggle ${mineOnly ? 'on' : ''}`} onClick={() => setMineOnly((v) => !v)}>
          내 작업만
        </button>
        <button type="button" className={`sc-toggle ${includeDone ? 'on' : ''}`} onClick={() => setIncludeDone((v) => !v)}>
          완료 포함
        </button>
      </div>

      {isLoading && data.items.length === 0 ? (
        <div className="bd-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>
      ) : error ? (
        <div className="bd-empty"><span>{error}</span></div>
      ) : data.items.length === 0 ? (
        <div className="sc-empty">
          <CalendarCheck size={28} color="var(--text-muted)" />
          <h3>{hasFilter ? '조건에 맞는 작업이 없습니다' : '아직 등록된 작업이 없습니다'}</h3>
          <p>
            {hasFilter ? '검색어나 필터를 바꿔 보세요.' : '폴더에서 ‘새 일정’을 만들고 작업을 추가하면 여기에 모입니다.'}
          </p>
        </div>
      ) : (
        <div className="sc-groups">
          {groups.map((group) => (
            <section key={group.key} className={`sc-group group-${group.key}`}>
              <header className="sc-group-head">
                <span className="sc-group-name">{group.label}</span>
                <span className="sc-group-count">{group.items.length}</span>
                {grouping === 'board' && group.items[0]?.board?.id && (
                  <button
                    type="button"
                    className="sc-group-open"
                    onClick={() => openBoard(group.items[0])}
                    title="이 일정 열기"
                  >
                    <FolderIcon size={11} /><span>일정 열기</span>
                  </button>
                )}
              </header>
              <div className="bd-table">
                {group.items.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    busy={busyId === task.id}
                    people={peopleByBoard[task.board?.id] || []}
                    showBoardName={grouping !== 'board'}
                    isOpen={openTask?.id === task.id}
                    onOpen={(t) => setOpenTask(t)}
                    onPatch={patch}
                    onDelete={removeTask}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {data.total_pages > 1 && (
        <div className="folder-pager">
          <button type="button" className="btn-secondary" disabled={page <= 1 || isLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft size={14} /><span className="hide-mobile">이전</span>
          </button>
          <span className="folder-pager-status">{page} / {data.total_pages}</span>
          <button type="button" className="btn-secondary" disabled={page >= data.total_pages || isLoading} onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}>
            <span className="hide-mobile">다음</span><ChevronRight size={14} />
          </button>
        </div>
      )}

      <DigestSettingsModal
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {openTask && (
        <TaskDetailDrawer
          boardFile={{
            id: openTask.file_id,
            folder_id: openTask.board?.folder_id,
            workspace_id: openTask.board?.workspace_id,
          }}
          task={openTask}
          canWrite
          assignableUsers={peopleByBoard[openTask.board?.id] || []}
          onClose={() => setOpenTask(null)}
          onSaved={(updated) => {
            setData((prev) => ({
              ...prev,
              items: prev.items.map((t) => (t.id === updated.id ? { ...t, ...updated, board: t.board } : t)),
            }));
            setOpenTask((prev) => (prev ? { ...prev, ...updated, board: prev.board } : prev));
          }}
        />
      )}
    </div>
  );
}
