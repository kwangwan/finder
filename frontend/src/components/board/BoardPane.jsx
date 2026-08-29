import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Loader2,
  Calendar,
  User as UserIcon,
  X,
} from '../../utils/icons';
import {
  getBoard,
  createBoardTask,
  updateBoardTask,
  deleteBoardTask,
} from '../../api';
import { useDialog } from '../../context/DialogContext';
import BoardTaskDetail from './BoardTaskDetail';

// Mirrors the server's vocabularies. Fetched values would be more correct in
// principle, but these have to be known before the first paint to colour a row,
// and the server refuses anything outside them anyway.
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

/**
 * How a deadline reads at a glance.
 *
 * Returned as a word rather than a colour so the styling stays in CSS and the
 * same judgement is used by the board and the 일정 tab.
 */
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

/** How far off the end of the period is, in words. */
/** Date only — the time a row was created is never the question being asked. */
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

export function remainingText(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft < 0) return `${-daysLeft}일 지남`;
  if (daysLeft === 0) return '오늘';
  return `${daysLeft}일 남음`;
}

/**
 * The period as one phrase.
 *
 * A task usually runs between two dates, so both are shown — but a single end
 * date is still the common case and must not read as a broken range.
 */
export function periodText(startDate, dueDate, daysLeft) {
  if (!startDate && !dueDate) return '기간 설정';
  const left = remainingText(daysLeft);
  const range = startDate && dueDate
    ? `${dayLabel(startDate)} – ${dayLabel(dueDate)}`
    : dueDate ? `${dayLabel(dueDate)}까지`
      : `${dayLabel(startDate)}부터`;
  return left ? `${range} · ${left}` : range;
}

export default function BoardPane({ file, onDirty }) {
  const { showConfirm, showAlert } = useDialog();
  const [board, setBoard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openTaskId, setOpenTaskId] = useState(null);
  const [addingUnder, setAddingUnder] = useState(undefined);   // undefined = closed, null = top level
  const [draftName, setDraftName] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [editingPeriodId, setEditingPeriodId] = useState(null);
  const draftRef = useRef(null);
  const addingRef = useRef(false);

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

  useEffect(() => {
    if (addingUnder === undefined) return;
    const id = setTimeout(() => draftRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [addingUnder]);

  const canWrite = board?.can_write !== false;
  const tasks = board?.tasks || [];

  // Rows in reading order: each top-level task followed by its sub-items.
  const rows = useMemo(() => {
    const top = tasks.filter((t) => !t.parent_task_id);
    const children = new Map();
    tasks.forEach((t) => {
      if (!t.parent_task_id) return;
      if (!children.has(t.parent_task_id)) children.set(t.parent_task_id, []);
      children.get(t.parent_task_id).push(t);
    });
    const out = [];
    top.forEach((t) => {
      const kids = children.get(t.id) || [];
      out.push({ task: t, depth: 0, childCount: kids.length });
      if (collapsed.has(t.id)) return;
      kids.forEach((k) => out.push({ task: k, depth: 1, childCount: 0 }));
    });
    return out;
  }, [tasks, collapsed]);

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
    if (!name) { setAddingUnder(undefined); setDraftName(''); return; }
    // Held down, Enter repeats — and the field was only cleared after the
    // round trip, so every repeat sent the same name again and the task
    // appeared twice. Cleared first, and a second call is refused while one
    // is in flight.
    if (addingRef.current) return;
    addingRef.current = true;
    setDraftName('');
    try {
      const created = await createBoardTask(file.id, { name, parent_task_id: parentTaskId ?? null });
      setBoard((prev) => ({ ...prev, tasks: [...prev.tasks, created] }));
      onDirty?.();
      // Left open, so a list of tasks can be typed in without reaching for the
      // button between each one.
      draftRef.current?.focus();
    } catch (e) {
      setDraftName(name);
      await showAlert({ title: '추가하지 못했습니다', message: e.message, type: 'error' });
    } finally {
      addingRef.current = false;
    }
  };

  const removeTask = async (task) => {
    const childCount = tasks.filter((t) => t.parent_task_id === task.id).length;
    const confirmed = await showConfirm({
      title: '작업 삭제',
      message: childCount
        ? `'${task.name}' 작업과 하위 작업 ${childCount}개를 삭제하시겠습니까?\n작업은 휴지통을 거치지 않고 바로 지워집니다.`
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

  const toggleCollapse = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return <div className="board-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>;
  }
  if (error) {
    return <div className="board-empty"><span>{error}</span></div>;
  }

  const openTask = tasks.find((t) => t.id === openTaskId) || null;

  return (
    <div className="board-pane">
      <div className="board-scroll">
        {rows.length === 0 && addingUnder === undefined && (
          <div className="board-empty-row">
            아직 작업이 없습니다. 아래 &apos;작업 추가&apos;로 시작해 보세요.
          </div>
        )}

        <div className="board-list">
          {rows.map(({ task, depth, childCount }) => (
            <div
              key={task.id}
              className={`board-card depth-${depth} ${openTaskId === task.id ? 'open' : ''} ${task.status === 'done' ? 'is-done' : ''} tone-${dueTone(task.days_left, task.status)}`}
            >
              <div className="board-card-top">
                {depth === 0 ? (
                  <button
                    type="button"
                    className={`board-twisty ${childCount ? '' : 'is-empty'}`}
                    onClick={() => childCount && toggleCollapse(task.id)}
                    title={childCount ? (collapsed.has(task.id) ? '하위 작업 펼치기' : '하위 작업 접기') : undefined}
                    tabIndex={childCount ? 0 : -1}
                  >
                    {childCount ? (collapsed.has(task.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />) : null}
                  </button>
                ) : <span className="board-twisty is-empty" />}

                <span className="board-name-wrap">
                  <button type="button" className="board-name-btn" onClick={() => setOpenTaskId(task.id)} title="상세 내용 열기">
                    {task.name}
                  </button>
                  {childCount > 0 && <span className="board-subcount" title={`하위 작업 ${childCount}개`}>{childCount}</span>}
                </span>

                <select
                  className={`board-chip priority-${task.priority}`}
                  value={task.priority}
                  disabled={!canWrite || busyId === task.id}
                  aria-label="중요도"
                  onChange={(e) => patch(task, { priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <select
                  className={`board-chip status-${task.status}`}
                  value={task.status}
                  disabled={!canWrite || busyId === task.id}
                  aria-label="진행 상태"
                  onChange={(e) => patch(task, { status: e.target.value })}
                >
                  {STATUSES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
                </select>

                <span className="board-card-actions">
                  {depth === 0 && canWrite && (
                    <button
                      type="button"
                      className="btn-icon"
                      title="하위 작업 추가"
                      onClick={() => { setAddingUnder(task.id); setDraftName(''); }}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                  {canWrite && (
                    <button type="button" className="btn-icon" title="작업 삭제" onClick={() => removeTask(task)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>

              {/* The second line carries everything that does not need to be
                  read at a glance. A task does not have to fit on one line,
                  and forcing it to made every column too narrow to use. */}
              <div className="board-card-meta">
                {/* Read as a phrase, edited only when asked. A pair of native
                    date inputs shows the browser's own format and a literal
                    "mm/dd/yyyy" whenever a date is unset — two of those on
                    every row was most of what made the board look unfinished. */}
                <span className={`board-period due-${dueTone(task.days_left, task.status)}`}>
                  {editingPeriodId === task.id ? (
                    <span className="board-period-edit" onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) setEditingPeriodId(null);
                    }}>
                      <input
                        type="date"
                        autoFocus
                        value={task.start_date || ''}
                        max={task.due_date || undefined}
                        aria-label="시작일"
                        onChange={(e) => patch(task, { start_date: e.target.value || null })}
                        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setEditingPeriodId(null); }}
                      />
                      <span className="board-period-dash">–</span>
                      <input
                        type="date"
                        value={task.due_date || ''}
                        min={task.start_date || undefined}
                        aria-label="종료일"
                        onChange={(e) => patch(task, { due_date: e.target.value || null })}
                        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setEditingPeriodId(null); }}
                      />
                      {(task.start_date || task.due_date) && (
                        <button
                          type="button"
                          className="board-period-clear"
                          onClick={() => { patch(task, { start_date: null, due_date: null }); setEditingPeriodId(null); }}
                          title="기간 지우기"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="board-period-btn"
                      disabled={!canWrite || busyId === task.id}
                      onClick={() => setEditingPeriodId(task.id)}
                      title={canWrite ? '기간 설정' : '기간'}
                    >
                      <Calendar size={12} />
                      <span>{periodText(task.start_date, task.due_date, null)}</span>
                    </button>
                  )}
                  {remainingText(task.days_left) && (
                    <span className="board-remaining">{remainingText(task.days_left)}</span>
                  )}
                </span>

                <span className="board-meta-people" title="작업자">
                  <UserIcon size={12} />
                  {task.assignees.length === 0
                    ? <span className="board-muted">지정 안 함</span>
                    : task.assignees.map((a) => (
                      <span key={a.id} className="board-person">{a.name}</span>
                    ))}
                </span>

                <span className="board-meta-stamp" title={`만든 날 ${fullStamp(task.created_at)}`}>
                  만듦 {shortStamp(task.created_at)}
                </span>
                <span className="board-meta-stamp" title={`마지막 수정 ${fullStamp(task.updated_at)}`}>
                  수정 {shortStamp(task.updated_at)}
                  {task.last_edited_by_name ? ` · ${task.last_edited_by_name}` : ''}
                </span>
              </div>
            </div>
          ))}

          {addingUnder !== undefined && (
            <div className={`board-card board-draft depth-${addingUnder ? 1 : 0}`}>
              <div className="board-card-top">
                <span className="board-twisty is-empty" />
                <input
                  ref={draftRef}
                  type="text"
                  className="board-draft-input"
                  value={draftName}
                  placeholder={addingUnder ? '하위 작업 이름' : '작업 이름'}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (e.repeat || e.nativeEvent.isComposing) return;
                      addTask(addingUnder);
                    }
                    if (e.key === 'Escape') { e.preventDefault(); setAddingUnder(undefined); setDraftName(''); }
                  }}
                />
                <button type="button" className="btn-primary board-draft-add" onClick={() => addTask(addingUnder)} disabled={!draftName.trim()}>
                  추가
                </button>
                <button type="button" className="btn-secondary board-draft-add" onClick={() => { setAddingUnder(undefined); setDraftName(''); }}>
                  닫기
                </button>
              </div>
              <div className="board-card-meta board-draft-hint">Enter로 계속 추가할 수 있습니다.</div>
            </div>
          )}
        </div>

        {canWrite && addingUnder === undefined && (
          <button
            type="button"
            className="board-add-btn"
            onClick={() => { setAddingUnder(null); setDraftName(''); }}
          >
            <Plus size={14} /><span>작업 추가</span>
          </button>
        )}
        {!canWrite && (
          <div className="board-readonly-note">읽기 전용입니다. 이 폴더에 쓰기 권한이 없습니다.</div>
        )}
      </div>

      {openTask && (
        <BoardTaskDetail
          file={file}
          task={openTask}
          canWrite={canWrite}
          assignableUsers={board?.assignable_users || []}
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
