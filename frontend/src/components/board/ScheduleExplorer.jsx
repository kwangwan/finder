import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck, Search, X, Loader2, ChevronLeft, ChevronRight, RefreshCw, Settings,
  Folder as FolderIcon, Clock, Plus,
} from '../../utils/icons';
import {
  listWorkspaceTasks, updateBoardTask, deleteBoardTask, createBoardTask,
  getFileDetail, getBoard, getDigestSettings,
} from '../../api';
import { useDialog } from '../../context/DialogContext';
import TaskRow from './TaskRow';
import TaskDetailDrawer from './TaskDetailDrawer';
import DigestSettingsModal from './DigestSettingsModal';
import { Dropdown, DateRangeField, Toggle } from './controls';

const PAGE_SIZE = 40;

/** The wall clock in the workspace's reference zone, to the second. */
function formatInZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  } catch (e) {
    return date.toLocaleString('ko-KR');
  }
}

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
  workspaceId, workspaceName = '', currentUser, onOpenBoard, onOpenFolder, refreshToken = 0,
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
  const [settingsRefresh, setSettingsRefresh] = useState(0);
  const [openTask, setOpenTask] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Who may be assigned differs per board (the shared workspace allows only
  // yourself), so it is fetched for the board a task actually belongs to.
  const [peopleByBoard, setPeopleByBoard] = useState({});
  // Adding here works the same as on a board: `{fileId, parentTaskId}` says
  // which 일정 the new 할 일 belongs to and, for a sub-item, under what.
  const [draft, setDraft] = useState(null);
  const [draftName, setDraftName] = useState('');
  const draftRef = useRef(null);
  const addingRef = useRef(false);

  useEffect(() => {
    if (!draft) return undefined;
    const id = setTimeout(() => draftRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [draft]);
  const [fromDate, setFromDate] = useState(null);
  const [toDate, setToDate] = useState(null);
  // The reference clock everything on a board is read against. Shown so nobody
  // has to guess which day the app thinks it is.
  const [zone, setZone] = useState({ timezone: null, label: '' });
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
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { setPage(1); }, [includeDone, mineOnly, priority, status, fromDate, toDate, workspaceId]);

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
  }, [workspaceId, search, includeDone, mineOnly, priority, status, fromDate, toDate, page, currentUser?.id]);

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
      title: '할 일 삭제',
      message: `'${task.name}' 할 일을 삭제하시겠습니까?\n하위 할 일이 있다면 함께 지워지며, 휴지통을 거치지 않습니다.`,
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

  const hasFilter = !!(search || includeDone || mineOnly || priority || status || fromDate || toDate);

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

        <Dropdown
          value={priority}
          label="중요도로 거르기"
          options={[
            { value: '', label: '중요도 전체' },
            { value: 'urgent', label: '긴급' }, { value: 'high', label: '높음' },
            { value: 'normal', label: '보통' }, { value: 'low', label: '낮음' },
          ]}
          onChange={setPriority}
        />
        <Dropdown
          value={status}
          label="진행 상태로 거르기"
          options={[
            { value: '', label: '상태 전체' },
            { value: 'todo', label: '대기' }, { value: 'in_progress', label: '진행 중' },
            { value: 'review', label: '검토' }, { value: 'done', label: '완료' },
            { value: 'hold', label: '보류' },
          ]}
          onChange={setStatus}
        />

        {/* Matches anything whose period touches the range, so a long-running
            item still shows up in a week it is actually running through. */}
        <DateRangeField
          start={fromDate}
          end={toDate}
          placeholder="기간 전체"
          onChange={(a, b) => { setFromDate(a); setToDate(b); }}
        />

        <Toggle
          on={mineOnly} onChange={setMineOnly}
          onLabel="내 담당만 보는 중" offLabel="모든 담당자"
          title="나에게 배정된 것만 볼지"
        />
        <Toggle
          on={includeDone} onChange={setIncludeDone}
          onLabel="완료도 함께 보는 중" offLabel="완료는 숨김"
          title="완료한 할 일을 목록에 포함할지"
        />
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
              <div className="bd-table">
                {group.items.map((task) => (
                  <React.Fragment key={task.id}>
                    <TaskRow
                      task={task}
                      depth={task.parent_task_id ? 1 : 0}
                      busy={busyId === task.id}
                      people={peopleByBoard[task.board?.id] || []}
                      showBoardName={grouping !== 'board'}
                      isOpen={openTask?.id === task.id}
                      onOpen={(t) => setOpenTask(t)}
                      onPatch={patch}
                      onDelete={removeTask}
                      onAddSub={(t) => { setDraft({ fileId: t.file_id, parentTaskId: t.id }); setDraftName(''); }}
                      onOpenBoardWindow={openBoard}
                      onOpenFolderWindow={openFolder}
                    />
                    {draft && draft.parentTaskId === task.id && renderDraft()}
                  </React.Fragment>
                ))}
                {/* Grouped by 일정, a group *is* one board, so a new 할 일 can
                    be added here without asking which board it belongs to. */}
                {grouping === 'board' && group.items[0]?.file_id && (
                  draft && !draft.parentTaskId && draft.fileId === group.items[0].file_id
                    ? renderDraft()
                    : (
                      <button
                        type="button"
                        className="bd-addrow"
                        onClick={() => { setDraft({ fileId: group.items[0].file_id, parentTaskId: null }); setDraftName(''); }}
                      >
                        <Plus size={13} /><span>이 일정에 할 일 추가</span>
                      </button>
                    )
                )}
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
        onClose={() => { setSettingsOpen(false); setSettingsRefresh((n) => n + 1); }}
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
