import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck, Search, X, Loader2, ChevronLeft, ChevronRight, RefreshCw, Settings,
  Folder as FolderIcon, Clock, Plus, Filter,
} from '../../utils/icons';
import {
  listWorkspaceTasks, updateBoardTask, deleteBoardTask, createBoardTask,
  getFileDetail, getBoard, getDigestSettings, listBoardAssignees,
} from '../../api';
import { useDialog } from '../../context/DialogContext';
import TaskRow from './TaskRow';
import DigestSettingsModal from './DigestSettingsModal';
import ScheduleFilterModal, { DEFAULT_FILTERS, activeFilters } from './ScheduleFilterModal';

const PAGE_SIZE = 40;

/** The wall clock in the workspace's reference zone, to the second. */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * The reference clock, read at a glance.
 *
 * "2026-08-30 13:03:29" is a timestamp, not a time somebody reads — the year
 * never changes, the seconds never matter, and the digits all look alike.
 * What is worth knowing is which day it is here and roughly when.
 */
function formatInZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone, weekday: 'short', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const weekday = (parts.weekday || '').replace('요일', '');
    return `${parts.month}월 ${parts.day}일 (${weekday}) ${parts.dayPeriod || ''} ${parts.hour}:${parts.minute}`.replace(/\s+/g, ' ').trim();
  } catch (e) {
    return date.toLocaleString('ko-KR');
  }
}

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
  workspaceId, workspaceName = '', currentUser, onOpenBoard, onOpenFolder, refreshToken = 0,
}) {
  const { showConfirm, showAlert } = useDialog();
  const [data, setData] = useState({ items: [], total: 0, page: 1, total_pages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // One object, because they are one thing: how this list is being looked at.
  // Starts on everything outstanding in the workspace; whose it is, is one of
  // the settings rather than a decision made for the reader.
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const { includeDone, assigneeId, priority, status, grouping, fromDate, toDate } = filters;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRefresh, setSettingsRefresh] = useState(0);
  const [busyId, setBusyId] = useState(null);
  // Who may be assigned differs per board (the shared workspace allows only
  // yourself), so it is fetched for the board a task actually belongs to.
  const [peopleByBoard, setPeopleByBoard] = useState({});
  // Adding here works the same as on a board: `{fileId, parentTaskId}` says
  // which 일정 the new 할 일 belongs to and, for a sub-item, under what.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleCollapse = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [draft, setDraft] = useState(null);
  const [draftName, setDraftName] = useState('');
  const draftRef = useRef(null);
  const addingRef = useRef(false);

  useEffect(() => {
    if (!draft) return undefined;
    const id = setTimeout(() => draftRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [draft]);
  // The reference clock everything on a board is read against. Shown so nobody
  // has to guess which day the app thinks it is.
  const [zone, setZone] = useState({ timezone: null, label: '' });
  // Who can be filtered by: everyone with a 할 일 here, this person first.
  const [people, setPeople] = useState([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!workspaceId) return;
    getDigestSettings(workspaceId)
      .then((res) => {
        const tz = res.defaults?.timezone;
        const label = (res.timezone_choices || []).find((t) => t.value === tz)?.label || tz;
        setZone({ timezone: tz, label });
      })
      .catch(() => {});
  }, [workspaceId, settingsRefresh]);

  useEffect(() => {
    if (!workspaceId) { setPeople([]); return undefined; }
    let cancelled = false;
    listBoardAssignees(workspaceId)
      .then((items) => { if (!cancelled) setPeople(items); })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, [workspaceId, refreshToken]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { setPage(1); }, [includeDone, assigneeId, priority, status, fromDate, toDate, workspaceId]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoading(true);
    try {
      const res = await listWorkspaceTasks({
        workspaceId,
        q: search,
        includeDone,
        assigneeId: assigneeId || null,
        priority: priority || null,
        status: status || null,
        fromDate,
        toDate,
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
  }, [workspaceId, search, includeDone, assigneeId, priority, status, fromDate, toDate, page]);

  useEffect(() => { load(); }, [load, refreshToken]);

  // Fetched once per board that appears on the page, not per row.
  useEffect(() => {
    const missing = [...new Set(data.items.map((t) => t.board?.id).filter(Boolean))]
      .filter((id) => !(id in peopleByBoard));
    if (missing.length === 0) return undefined;
    let cancelled = false;
    Promise.all(missing.map((id) => getBoard(id)
      .then((b) => [id, { people: b.assignable_users || [], locked: !!b.assignee_locked }])
      .catch(() => [id, { people: [], locked: false }])))
      .then((pairs) => { if (!cancelled) setPeopleByBoard((prev) => ({ ...prev, ...Object.fromEntries(pairs) })); });
    return () => { cancelled = true; };
  }, [data.items, peopleByBoard]);

  // A change to one of these can move a 할 일 out of what this screen is
  // showing — marking it 완료 while 완료 is hidden, taking yourself off it
  // while only your own are listed. The row is updated in place either way,
  // and then the list is re-read so what is on screen still answers the
  // question the filters asked.
  const AFFECTS_MEMBERSHIP = ['status', 'assignee_ids', 'priority', 'start_date', 'due_date'];

  const patch = async (task, payload) => {
    setBusyId(task.id);
    try {
      const updated = await updateBoardTask(task.file_id, task.id, payload);
      const apply = (t) => (t.id === task.id ? { ...t, ...updated, board: t.board } : t);
      setData((prev) => ({
        ...prev,
        items: prev.items.map((t) => ({
          ...apply(t),
          children: (t.children || []).map(apply),
        })),
      }));
      if (Object.keys(payload).some((k) => AFFECTS_MEMBERSHIP.includes(k))) load();
    } catch (e) {
      await showAlert({ title: '저장하지 못했습니다', message: e.message, type: 'error' });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const removeTask = async (task) => {
    const confirmed = await showConfirm({
      title: '할 일 삭제',
      message: `'${task.name}' 할 일을 삭제하시겠습니까?\n하위 할 일이 있다면 함께 지워지며, 휴지통을 거치지 않습니다.`,
      confirmText: '삭제',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteBoardTask(task.file_id, task.id);
      // A sub-item is removed from its parent; a top-level one takes its
      // sub-items with it, which is what the server just did.
      setData((prev) => ({
        ...prev,
        items: prev.items
          .filter((t) => t.id !== task.id)
          .map((t) => ({ ...t, children: (t.children || []).filter((c) => c.id !== task.id) })),
        total: task.parent_task_id ? prev.total : prev.total - 1,
      }));
    } catch (e) {
      await showAlert({ title: '삭제하지 못했습니다', message: e.message, type: 'error' });
    }
  };

  const addTask = async () => {
    const name = draftName.trim();
    if (!draft || !name) { setDraft(null); setDraftName(''); return; }
    if (addingRef.current) return;
    addingRef.current = true;
    setDraftName('');
    try {
      await createBoardTask(draft.fileId, { name, parent_task_id: draft.parentTaskId ?? null });
      await load();
      draftRef.current?.focus();
    } catch (e) {
      setDraftName(name);
      await showAlert({ title: '추가하지 못했습니다', message: e.message, type: 'error' });
    } finally {
      addingRef.current = false;
    }
  };

  const renderDraft = () => (
    <div className="bd-row bd-draft">
      <div className="bd-f-name">
        <span className="bd-twisty is-empty" />
        <input
          ref={draftRef}
          type="text"
          value={draftName}
          placeholder={draft?.parentTaskId ? '하위 할 일 이름' : '할 일 이름'}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.repeat || e.nativeEvent.isComposing) return;
              addTask();
            }
            if (e.key === 'Escape') { e.preventDefault(); setDraft(null); setDraftName(''); }
          }}
        />
      </div>
      <div className="bd-draft-actions">
        <button type="button" className="btn-primary" onClick={addTask} disabled={!draftName.trim()}>추가</button>
        <button type="button" className="btn-secondary" onClick={() => { setDraft(null); setDraftName(''); }}>닫기</button>
        <span className="bd-draft-hint">Enter로 계속 추가</span>
      </div>
    </div>
  );

  // The 할 일's own document, opened as a document — the same window, the
  // same editor, the same history as anything else written here.
  const openDocument = (task) => {
    if (!task.document_id) return;
    onOpenBoard?.({
      id: task.document_id,
      name: task.name,
      file_type: 'note',
      is_markdown: true,
      folder_id: task.board?.folder_id || null,
      workspace_id: task.board?.workspace_id || null,
    });
  };

  const openBoard = async (task) => {
    if (!task.board?.id) return;
    try { onOpenBoard?.(await getFileDetail(task.board.id)); } catch (e) { /* removed since listing */ }
  };

  // The folder is where the schedule's attachments live, so getting to it from
  // a row is the difference between "I can see this" and "I can work on it".
  const openFolder = (task) => {
    if (!task.board) return;
    onOpenFolder?.({ id: task.board.folder_id || null, name: task.board.name }, task.board.workspace_id);
  };

  /**
   * The page split into labelled groups.
   *
   * Ordered so the first heading is always the one to read first. The server
   * already returns the page in urgency order, so grouping never reorders
   * anything within a group.
   */
  /**
   * Two levels: when to do it, then what it is part of.
   *
   * Both matter and neither replaces the other — a deadline says whether to
   * look now, and the 일정 says what the work belongs to. So the outer heading
   * is whichever the user chose and the inner one is always the 일정, except
   * when that *is* the outer choice and a second copy would say nothing.
   */
  const groups = useMemo(() => {
    const items = data.items;

    // How urgent a top-level 할 일 is, counting its sub-items: work due today
    // is due today whichever row carries the date. A sub-item that is already
    // done is left out of the reckoning — a finished step cannot make the 할
    // 일 it belongs to late.
    const soonest = (t) => {
      const all = [t, ...(t.children || [])]
        .filter((x) => x.status !== 'done')
        .map((x) => x.days_left)
        .filter((d) => d !== null && d !== undefined);
      return all.length ? Math.min(...all) : null;
    };

    const byBoard = (list) => {
      const map = new Map();
      list.forEach((t) => {
        const key = t.board?.id || 'none';
        if (!map.has(key)) {
          map.set(key, { key, label: t.board?.name || '(삭제된 일정)', fileId: t.file_id, items: [] });
        }
        map.get(key).items.push(t);
      });
      return [...map.values()];
    };

    let outer;
    if (grouping === 'board') {
      return byBoard(items).map((g) => ({ ...g, boards: [g] }));
    }
    if (grouping === 'status') {
      const order = ['todo', 'in_progress', 'review', 'hold', 'done'];
      const labels = { todo: '대기', in_progress: '진행 중', review: '검토', hold: '보류', done: '완료' };
      outer = order
        .map((st) => ({ key: st, label: labels[st], items: items.filter((t) => t.status === st) }))
        .filter((g) => g.items.length);
    } else {
      // A finished 할 일 is not late, whatever its date said — it is done, and
      // listing it under 기한 지남 would make a closed thing look outstanding.
      // The 할 일 itself decides: its sub-items follow it.
      const isDone = (t) => t.status === 'done';
      const buckets = [
        { key: 'overdue', label: '기한 지남', test: (t, d) => !isDone(t) && d !== null && d < 0 },
        { key: 'today', label: '오늘', test: (t, d) => !isDone(t) && d === 0 },
        { key: 'week', label: '7일 이내', test: (t, d) => !isDone(t) && d > 0 && d <= 7 },
        { key: 'month', label: '30일 이내', test: (t, d) => !isDone(t) && d > 7 && d <= 30 },
        { key: 'later', label: '그 이후', test: (t, d) => !isDone(t) && d > 30 },
        { key: 'none', label: '기간 없음', test: (t, d) => !isDone(t) && d === null },
        { key: 'done', label: '완료', test: (t) => isDone(t) },
      ];
      outer = buckets
        .map((b) => ({ key: b.key, label: b.label, items: items.filter((t) => b.test(t, soonest(t))) }))
        .filter((g) => g.items.length);
    }
    return outer.map((g) => ({ ...g, boards: byBoard(g.items) }));
  }, [data.items, grouping]);

  const chips = activeFilters(filters);
  const hasFilter = !!search || chips.length > 0;

  return (
    <div className="sc-explorer">
      <div className="sc-head">
        <div className="sc-title">
          <CalendarCheck size={18} color="var(--accent-primary)" />
          <h2>일정</h2>
          <span className="sc-count">{data.total}건</span>
        </div>
        <div className="sc-head-actions">
          <span className="sc-clock" title={`기준시: ${zone.label || '불러오는 중'}`}>
            <Clock size={13} />
            <span className="sc-clock-time">{zone.timezone ? formatInZone(now, zone.timezone) : '—'}</span>
            <span className="sc-clock-zone">{zone.label ? zone.label.replace(/\s*\(.*\)$/, '') : ''}</span>
          </span>
          <button type="button" className="btn-secondary" onClick={() => setSettingsOpen(true)} title="기준시와 알림 설정">
            <Settings size={14} />
            <span className="hide-mobile">설정</span>
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
            placeholder="할 일 이름 검색..." aria-label="할 일 검색"
          />
          {query && <button type="button" onClick={() => setQuery('')} title="검색어 지우기"><X size={13} /></button>}
        </div>

        <button
          type="button"
          className={`btn-secondary sc-filter-btn ${chips.length ? 'on' : ''}`}
          onClick={() => setFiltersOpen(true)}
          title="보기 설정"
        >
          <Filter size={14} />
          <span>보기 설정</span>
          {chips.length > 0 && <span className="sc-filter-count">{chips.length}</span>}
        </button>

        {/* What is on, said back — the settings are put away, not hidden. */}
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className="sc-chip"
            onClick={() => setFilters((prev) => ({ ...prev, ...c.reset }))}
            title="이 조건 끄기"
          >
            <span>{c.label}</span>
            <X size={11} />
          </button>
        ))}
      </div>

      {isLoading && data.items.length === 0 ? (
        <div className="bd-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>
      ) : error ? (
        <div className="bd-empty"><span>{error}</span></div>
      ) : data.items.length === 0 ? (
        <div className="sc-empty">
          <CalendarCheck size={28} color="var(--text-muted)" />
          <h3>{hasFilter ? '조건에 맞는 할 일이 없습니다' : '아직 등록된 할 일이 없습니다'}</h3>
          <p>
            {hasFilter ? '검색어나 필터를 바꿔 보세요.' : '폴더에서 ‘새 일정’을 만들고 할 일을 추가하면 여기에 모입니다.'}
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

              {group.boards.map((board) => (
                <div key={board.key} className="sc-board">
                  {/* Which 일정 this belongs to, once per run of rows rather
                      than repeated on every one of them. */}
                  {grouping !== 'board' && (
                    <div className="sc-board-head">
                      <button
                        type="button"
                        className="sc-board-name"
                        onClick={() => board.items[0] && openBoard(board.items[0])}
                        title="이 일정 열기"
                      >
                        <FolderIcon size={11} /><span>{board.label}</span>
                      </button>
                      <span className="sc-board-count">{board.items.length}</span>
                    </div>
                  )}

                  <div className="bd-table">
                    {board.items.map((task) => (
                      <React.Fragment key={task.id}>
                        <TaskRow
                          task={task}
                          depth={0}
                          childCount={(task.children || []).length}
                          collapsed={collapsed.has(task.id)}
                          busy={busyId === task.id}
                          people={peopleByBoard[task.board?.id]?.people || []}
                          assigneeLocked={!!peopleByBoard[task.board?.id]?.locked}
                          onToggleCollapse={toggleCollapse}
                          onOpen={openDocument}
                          onPatch={patch}
                          onDelete={removeTask}
                          onAddSub={(t) => { setDraft({ fileId: t.file_id, parentTaskId: t.id }); setDraftName(''); }}
                          onOpenBoardWindow={openBoard}
                          onOpenFolderWindow={openFolder}
                        />
                        {/* Sub-items sit under what they are part of, whether
                            or not they have a period of their own. */}
                        {!collapsed.has(task.id) && (task.children || []).map((child) => (
                          <TaskRow
                            key={child.id}
                            task={child}
                            depth={1}
                            busy={busyId === child.id}
                            people={peopleByBoard[child.board?.id]?.people || []}
                            assigneeLocked={!!peopleByBoard[child.board?.id]?.locked}
                            onOpen={openDocument}
                            onPatch={patch}
                            onDelete={removeTask}
                          />
                        ))}
                        {draft && draft.parentTaskId === task.id && renderDraft()}
                      </React.Fragment>
                    ))}

                    {board.fileId && (
                      draft && !draft.parentTaskId && draft.fileId === board.fileId
                        ? renderDraft()
                        : (
                          <button
                            type="button"
                            className="bd-addrow"
                            onClick={() => { setDraft({ fileId: board.fileId, parentTaskId: null }); setDraftName(''); }}
                          >
                            <Plus size={13} /><span>이 일정에 할 일 추가</span>
                          </button>
                        )
                    )}
                  </div>
                </div>
              ))}
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
        onClose={() => { setSettingsOpen(false); setSettingsRefresh((n) => n + 1); }}
      />

      <ScheduleFilterModal
        isOpen={filtersOpen}
        filters={filters}
        people={people}
        currentUserId={currentUser?.id}
        onChange={setFilters}
        onClose={() => setFiltersOpen(false)}
      />

    </div>
  );
}
