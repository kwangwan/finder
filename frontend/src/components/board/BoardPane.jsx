import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Loader2,
  Calendar,
  X,
  GripVertical,
  Check,
} from '../../utils/icons';
import {
  getBoard,
  createBoardTask,
  updateBoardTask,
  deleteBoardTask,
  reorderBoardTasks,
  renameFile,
} from '../../api';
import { useDialog } from '../../context/DialogContext';
import BoardTaskDetail from './BoardTaskDetail';

export const PRIORITIES = [
  { value: 'urgent', label: '긴급' },
  { value: 'high', label: '높음' },
  { value: 'normal', label: '보통' },
  { value: 'low', label: '낮음' },
];
export const STATUSES = [
  { value: 'todo', label: '대기' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'review', label: '검토' },
  { value: 'done', label: '완료' },
  { value: 'hold', label: '보류' },
];

/** How a deadline reads at a glance, as a word so the styling stays in CSS. */
export function dueTone(daysLeft, status) {
  if (status === 'done') return 'done';
  if (daysLeft === null || daysLeft === undefined) return 'none';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= 3) return 'soon';
  return 'later';
}

function dayLabel(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}

export function remainingText(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft < 0) return `${-daysLeft}일 지남`;
  if (daysLeft === 0) return '오늘';
  return `${daysLeft}일 남음`;
}

export function periodText(startDate, dueDate, daysLeft) {
  if (!startDate && !dueDate) return '기간 설정';
  const left = remainingText(daysLeft);
  const range = startDate && dueDate
    ? `${dayLabel(startDate)} – ${dayLabel(dueDate)}`
    : dueDate ? `${dayLabel(dueDate)}까지` : `${dayLabel(startDate)}부터`;
  return left ? `${range} · ${left}` : range;
}

export function shortStamp(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear() % 100}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function fullStamp(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR');
}

/** An avatar rather than a name chip: several people fit in one narrow cell. */
export function initialOf(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}

export function colorForName(name) {
  const palette = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f43f5e'];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export default function BoardPane({ file, onDirty, onRenamed }) {
  const { showConfirm, showAlert } = useDialog();
  const [board, setBoard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openTaskId, setOpenTaskId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [editingPeriodId, setEditingPeriodId] = useState(null);
  const [peoplePickerId, setPeoplePickerId] = useState(null);

  // `null` means the row being typed sits at the end of the board; a task id
  // means it sits directly under that task, which is where a sub-item goes.
  const [draftUnder, setDraftUnder] = useState(undefined);
  const [draftName, setDraftName] = useState('');
  const draftRef = useRef(null);
  const addingRef = useRef(false);

  const [title, setTitle] = useState(file.name);
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  // Which task's "add sub-item" row is showing. Rendering one under every task
  // doubled the length of the board.
  const [hoverId, setHoverId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setBoard(await getBoard(file.id));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [file.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTitle(file.name); }, [file.name]);

  useEffect(() => {
    if (draftUnder === undefined) return undefined;
    const id = setTimeout(() => draftRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [draftUnder]);

  useEffect(() => {
    if (!peoplePickerId) return undefined;
    const close = (e) => {
      if (e.target.closest?.('.bd-people-pop, .bd-cell-people')) return;
      setPeoplePickerId(null);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [peoplePickerId]);

  const canWrite = board?.can_write !== false;
  const tasks = useMemo(() => board?.tasks || [], [board]);

  const childrenOf = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      if (!t.parent_task_id) return;
      if (!map.has(t.parent_task_id)) map.set(t.parent_task_id, []);
      map.get(t.parent_task_id).push(t);
    });
    map.forEach((list) => list.sort((a, b) => a.position - b.position));
    return map;
  }, [tasks]);

  const topLevel = useMemo(
    () => tasks.filter((t) => !t.parent_task_id).slice().sort((a, b) => a.position - b.position),
    [tasks],
  );

  const patch = async (task, payload) => {
    setBusyId(task.id);
    try {
      const updated = await updateBoardTask(file.id, task.id, payload);
      setBoard((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, ...updated } : t)),
      }));
      onDirty?.();
    } catch (e) {
      await showAlert({ title: '저장하지 못했습니다', message: e.message, type: 'error' });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const addTask = async (parentTaskId) => {
    const name = draftName.trim();
    if (!name) { setDraftUnder(undefined); setDraftName(''); return; }
    // Held down, Enter repeats — and the field used to be cleared only after
    // the round trip, so every repeat sent the same name and the task appeared
    // twice. Cleared first, and a second call refused while one is in flight.
    if (addingRef.current) return;
    addingRef.current = true;
    setDraftName('');
    try {
      const created = await createBoardTask(file.id, { name, parent_task_id: parentTaskId ?? null });
      setBoard((prev) => ({ ...prev, tasks: [...prev.tasks, created] }));
      if (parentTaskId) {
        setCollapsed((prev) => { const next = new Set(prev); next.delete(parentTaskId); return next; });
      }
      onDirty?.();
      draftRef.current?.focus();
    } catch (e) {
      setDraftName(name);
      await showAlert({ title: '추가하지 못했습니다', message: e.message, type: 'error' });
    } finally {
      addingRef.current = false;
    }
  };

  const removeTask = async (task) => {
    const kids = childrenOf.get(task.id)?.length || 0;
    const confirmed = await showConfirm({
      title: '작업 삭제',
      message: kids
        ? `'${task.name}' 작업과 하위 작업 ${kids}개를 삭제하시겠습니까?\n작업은 휴지통을 거치지 않고 바로 지워집니다.`
        : `'${task.name}' 작업을 삭제하시겠습니까?\n작업은 휴지통을 거치지 않고 바로 지워집니다.`,
      confirmText: '삭제',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteBoardTask(file.id, task.id);
      setBoard((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== task.id && t.parent_task_id !== task.id),
      }));
      if (openTaskId === task.id) setOpenTaskId(null);
      onDirty?.();
    } catch (e) {
      await showAlert({ title: '삭제하지 못했습니다', message: e.message, type: 'error' });
    }
  };

  const commitTitle = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === file.name) { setTitle(file.name); return; }
    try {
      await renameFile(file.id, trimmed);
      onRenamed?.(trimmed);
      onDirty?.();
    } catch (e) {
      setTitle(file.name);
      await showAlert({ title: '이름을 바꾸지 못했습니다', message: e.message, type: 'error' });
    }
  };

  const toggleCollapse = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAssignee = (task, userId) => {
    const current = task.assignees.map((a) => a.id);
    patch(task, {
      assignee_ids: current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    });
  };

  // --- reordering ----------------------------------------------------------
  // The whole level is sent at once. Nudging one row's position would let two
  // people dragging at the same time interleave into an order neither chose.
  const commitOrder = async (parentTaskId, orderedIds) => {
    const previous = tasks;
    setBoard((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => {
        const index = orderedIds.indexOf(t.id);
        return index === -1 ? t : { ...t, position: (index + 1) * 100 };
      }),
    }));
    try {
      await reorderBoardTasks(file.id, parentTaskId ?? null, orderedIds);
      onDirty?.();
    } catch (e) {
      setBoard((prev) => ({ ...prev, tasks: previous }));
      await showAlert({ title: '순서를 바꾸지 못했습니다', message: e.message, type: 'error' });
    }
  };

  const handleDrop = (target) => {
    const source = tasks.find((t) => t.id === dragId);
    setDragId(null);
    setDropTarget(null);
    if (!source || !target || source.id === target.id) return;
    // Only within one level: dragging a sub-item out to the top would change
    // what it belongs to, which is a different action from ordering.
    if ((source.parent_task_id || null) !== (target.parent_task_id || null)) return;
    const siblings = source.parent_task_id ? (childrenOf.get(source.parent_task_id) || []) : topLevel;
    const ids = siblings.map((t) => t.id).filter((id) => id !== source.id);
    const at = ids.indexOf(target.id);
    ids.splice(at === -1 ? ids.length : at, 0, source.id);
    commitOrder(source.parent_task_id || null, ids);
  };

  const rowDragProps = (task) => (canWrite ? {
    draggable: true,
    onDragStart: (e) => {
      setDragId(task.id);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', task.id); } catch (err) { /* Safari refuses some types */ }
    },
    onDragEnd: () => { setDragId(null); setDropTarget(null); },
    onDragOver: (e) => {
      if (!dragId || dragId === task.id) return;
      const source = tasks.find((t) => t.id === dragId);
      if (!source || (source.parent_task_id || null) !== (task.parent_task_id || null)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== task.id) setDropTarget(task.id);
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDropTarget((prev) => (prev === task.id ? null : prev));
    },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); handleDrop(task); },
  } : {});

  const renderDraft = (parentId) => (
    <div className={`bd-row bd-draft depth-${parentId ? 1 : 0}`}>
      <div className="bd-cell bd-cell-name">
        <span className="bd-grip" />
        <span className="bd-twisty is-empty" />
        <input
          ref={draftRef}
          type="text"
          value={draftName}
          placeholder={parentId ? '하위 작업 이름' : '작업 이름'}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.repeat || e.nativeEvent.isComposing) return;
              addTask(parentId);
            }
            if (e.key === 'Escape') { e.preventDefault(); setDraftUnder(undefined); setDraftName(''); }
          }}
        />
      </div>
      <div className="bd-cell bd-draft-actions">
        <button type="button" className="btn-primary" onClick={() => addTask(parentId)} disabled={!draftName.trim()}>추가</button>
        <button type="button" className="btn-secondary" onClick={() => { setDraftUnder(undefined); setDraftName(''); }}>닫기</button>
        <span className="bd-draft-hint">Enter로 계속 추가</span>
      </div>
    </div>
  );

  const renderRow = (task, depth) => {
    const kids = childrenOf.get(task.id) || [];
    const isCollapsed = collapsed.has(task.id);
    const tone = dueTone(task.days_left, task.status);
    return (
      <React.Fragment key={task.id}>
        <div
          className={`bd-row depth-${depth} ${openTaskId === task.id ? 'is-open' : ''} ${task.status === 'done' ? 'is-done' : ''} ${dragId === task.id ? 'is-dragging' : ''} ${dropTarget === task.id ? 'is-drop' : ''}`}
          onMouseEnter={() => setHoverId(depth === 0 ? task.id : task.parent_task_id)}
          {...rowDragProps(task)}
        >
          {/* Sticky: the name is the one column that must survive scrolling
              sideways, which is what a narrow window forces. */}
          <div className={`bd-cell bd-cell-name tone-${tone}`}>
            <span className="bd-grip" title={canWrite ? '끌어서 순서 변경' : undefined}>
              {canWrite && <GripVertical size={12} />}
            </span>
            {depth === 0 ? (
              <button
                type="button"
                className={`bd-twisty ${kids.length ? '' : 'is-empty'}`}
                onClick={() => kids.length && toggleCollapse(task.id)}
                tabIndex={kids.length ? 0 : -1}
                title={kids.length ? (isCollapsed ? '하위 작업 펼치기' : '하위 작업 접기') : undefined}
              >
                {kids.length ? (isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />) : null}
              </button>
            ) : <span className="bd-twisty is-empty" />}
            <button type="button" className="bd-name" onClick={() => setOpenTaskId(task.id)} title={task.name}>
              {task.name}
            </button>
            {kids.length > 0 && <span className="bd-subcount" title={`하위 작업 ${kids.length}개`}>{kids.length}</span>}
          </div>

          <div className="bd-cell bd-cell-people">
            <button
              type="button"
              className="bd-people"
              disabled={!canWrite}
              onClick={() => setPeoplePickerId((prev) => (prev === task.id ? null : task.id))}
              title={task.assignees.map((a) => a.name).join(', ') || '작업자 지정'}
            >
              {task.assignees.length === 0
                ? <span className="bd-avatar is-empty">+</span>
                : task.assignees.slice(0, 3).map((a) => (
                  <span key={a.id} className="bd-avatar" style={{ background: colorForName(a.name) }}>
                    {initialOf(a.name)}
                  </span>
                ))}
              {task.assignees.length > 3 && <span className="bd-avatar is-more">+{task.assignees.length - 3}</span>}
            </button>
            {peoplePickerId === task.id && (
              <div className="bd-people-pop">
                {people.length === 0 && <div className="bd-pop-empty">지정할 수 있는 사람이 없습니다.</div>}
                {people.map((u) => {
                  const on = task.assignees.some((a) => a.id === u.id);
                  return (
                    <button key={u.id} type="button" className={on ? 'on' : ''} onClick={() => toggleAssignee(task, u.id)}>
                      <span className="bd-avatar" style={{ background: colorForName(u.name) }}>{initialOf(u.name)}</span>
                      <span className="bd-pop-name">{u.name}</span>
                      {on && <Check size={12} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Solid, full-cell colour: a board is read by colour first, and a
              small outlined pill in a wide cell reads as nothing at all. */}
          <div className="bd-cell bd-cell-select">
            <select
              className={`bd-pill status-${task.status}`}
              value={task.status}
              disabled={!canWrite || busyId === task.id}
              aria-label="진행 상태"
              onChange={(e) => patch(task, { status: e.target.value })}
            >
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="bd-cell bd-cell-select">
            <select
              className={`bd-pill priority-${task.priority}`}
              value={task.priority}
              disabled={!canWrite || busyId === task.id}
              aria-label="중요도"
              onChange={(e) => patch(task, { priority: e.target.value })}
            >
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div className={`bd-cell bd-cell-period due-${tone}`}>
            {editingPeriodId === task.id ? (
              <span
                className="bd-period-edit"
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setEditingPeriodId(null); }}
              >
                <input
                  type="date" autoFocus value={task.start_date || ''} max={task.due_date || undefined}
                  aria-label="시작일"
                  onChange={(e) => patch(task, { start_date: e.target.value || null })}
                  onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setEditingPeriodId(null); }}
                />
                <span className="bd-dash">–</span>
                <input
                  type="date" value={task.due_date || ''} min={task.start_date || undefined}
                  aria-label="종료일"
                  onChange={(e) => patch(task, { due_date: e.target.value || null })}
                  onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setEditingPeriodId(null); }}
                />
                {(task.start_date || task.due_date) && (
                  <button
                    type="button" className="bd-period-clear" title="기간 지우기"
                    onClick={() => { patch(task, { start_date: null, due_date: null }); setEditingPeriodId(null); }}
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            ) : (
              <button
                type="button" className="bd-period"
                disabled={!canWrite || busyId === task.id}
                onClick={() => setEditingPeriodId(task.id)}
                title={canWrite ? '기간 설정' : '기간'}
              >
                <Calendar size={11} />
                <span className="bd-period-text">{periodText(task.start_date, task.due_date, null)}</span>
                {remainingText(task.days_left) && (
                  <span className="bd-remaining">{remainingText(task.days_left)}</span>
                )}
              </button>
            )}
          </div>

          <div className="bd-cell bd-cell-stamp" title={`만든 날 ${fullStamp(task.created_at)}`}>
            {shortStamp(task.created_at)}
          </div>
          <div
            className="bd-cell bd-cell-stamp"
            title={`마지막 수정 ${fullStamp(task.updated_at)}${task.last_edited_by_name ? ` · ${task.last_edited_by_name}` : ''}`}
          >
            {shortStamp(task.updated_at)}
          </div>

          <div className="bd-cell bd-cell-actions">
            {canWrite && (
              <button type="button" className="btn-icon" title="작업 삭제" onClick={() => removeTask(task)}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Sub-items, then the field for adding one — directly under the task
            they belong to, which is where a new row is expected to appear. */}
        {!isCollapsed && kids.map((kid) => renderRow(kid, 1))}
        {!isCollapsed && draftUnder === task.id && renderDraft(task.id)}
        {!isCollapsed && canWrite && depth === 0 && draftUnder !== task.id
          && (kids.length > 0 || hoverId === task.id) && (
          <button
            type="button"
            className="bd-subadd"
            onClick={() => { setDraftUnder(task.id); setDraftName(''); }}
          >
            <Plus size={12} /><span>하위 작업 추가</span>
          </button>
        )}
      </React.Fragment>
    );
  };

  if (isLoading) {
    return <div className="bd-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>;
  }
  if (error) {
    return <div className="bd-empty"><span>{error}</span></div>;
  }

  const openTask = tasks.find((t) => t.id === openTaskId) || null;
  const people = board?.assignable_users || [];
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="bd-pane">
      <div className="bd-header">
        <input
          className="bd-title"
          value={title}
          disabled={!canWrite}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); setTitle(file.name); e.target.blur(); }
          }}
          title="이름을 눌러 바꿀 수 있습니다"
          aria-label="일정 이름"
        />
        <span className="bd-header-stat">
          작업 {tasks.length}개
          {doneCount > 0 && <span className="bd-header-done"> · 완료 {doneCount}</span>}
        </span>
        {canWrite && (
          <button
            type="button"
            className="btn-primary bd-add-top"
            onClick={() => { setDraftUnder(null); setDraftName(''); }}
          >
            <Plus size={13} /><span>새 작업</span>
          </button>
        )}
      </div>

      <div className="bd-scroll" onMouseLeave={() => setHoverId(null)}>
        <div className="bd-table">
          <div className="bd-row bd-head">
            <div className="bd-cell bd-cell-name">작업</div>
            <div className="bd-cell bd-cell-people">작업자</div>
            <div className="bd-cell bd-cell-select">진행 상태</div>
            <div className="bd-cell bd-cell-select">중요도</div>
            <div className="bd-cell bd-cell-period">기간</div>
            <div className="bd-cell bd-cell-stamp">생성일</div>
            <div className="bd-cell bd-cell-stamp">수정일</div>
            <div className="bd-cell bd-cell-actions" />
          </div>

          {topLevel.length === 0 && draftUnder === undefined && (
            <div className="bd-empty-row">아직 작업이 없습니다. ‘새 작업’으로 시작해 보세요.</div>
          )}

          {topLevel.map((task) => renderRow(task, 0))}
          {draftUnder === null && renderDraft(null)}

          {canWrite && draftUnder !== null && (
            <button
              type="button"
              className="bd-addrow"
              onClick={() => { setDraftUnder(null); setDraftName(''); }}
            >
              <Plus size={13} /><span>작업 추가</span>
            </button>
          )}
        </div>
        {!canWrite && <div className="bd-readonly">읽기 전용입니다. 이 폴더에 쓰기 권한이 없습니다.</div>}
      </div>

      {openTask && (
        <BoardTaskDetail
          file={file}
          task={openTask}
          canWrite={canWrite}
          assignableUsers={people}
          onClose={() => setOpenTaskId(null)}
          onSaved={(updated) => {
            setBoard((prev) => ({
              ...prev,
              tasks: prev.tasks.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
            }));
            onDirty?.();
          }}
        />
      )}
    </div>
  );
}
