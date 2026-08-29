import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Loader2,
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

export function dueText(dueDate, daysLeft) {
  if (!dueDate) return '기한 없음';
  const [, m, d] = dueDate.split('-');
  const label = `${Number(m)}월 ${Number(d)}일`;
  if (daysLeft === null || daysLeft === undefined) return label;
  if (daysLeft < 0) return `${label} · ${-daysLeft}일 지남`;
  if (daysLeft === 0) return `${label} · 오늘`;
  return `${label} · ${daysLeft}일 남음`;
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
  const draftRef = useRef(null);

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
    try {
      const created = await createBoardTask(file.id, { name, parent_task_id: parentTaskId ?? null });
      setBoard((prev) => ({ ...prev, tasks: [...prev.tasks, created] }));
      setDraftName('');
      onDirty?.();
      // Left open, so a list of tasks can be typed in without reaching for the
      // button between each one.
      draftRef.current?.focus();
    } catch (e) {
      await showAlert({ title: '추가하지 못했습니다', message: e.message, type: 'error' });
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
        <div className="board-table" role="table">
          <div className="board-row board-head" role="row">
            <span className="bc-name">작업</span>
            <span className="bc-priority">중요도</span>
            <span className="bc-status">진행 상태</span>
            <span className="bc-due">기한</span>
            <span className="bc-people">작업자</span>
            <span className="bc-actions" />
          </div>

          {rows.length === 0 && addingUnder === undefined && (
            <div className="board-empty-row">
              아직 작업이 없습니다. 아래 &apos;작업 추가&apos;로 시작해 보세요.
            </div>
          )}

          {rows.map(({ task, depth, childCount }) => (
            <div
              key={task.id}
              className={`board-row depth-${depth} ${openTaskId === task.id ? 'open' : ''} ${task.status === 'done' ? 'is-done' : ''}`}
              role="row"
            >
              <span className="bc-name">
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
                <button type="button" className="board-name-btn" onClick={() => setOpenTaskId(task.id)} title="상세 내용 열기">
                  {task.name}
                </button>
                {childCount > 0 && <span className="board-subcount">{childCount}</span>}
              </span>

              <span className="bc-priority">
                <select
                  className={`board-chip priority-${task.priority}`}
                  value={task.priority}
                  disabled={!canWrite || busyId === task.id}
                  onChange={(e) => patch(task, { priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </span>

              <span className="bc-status">
                <select
                  className={`board-chip status-${task.status}`}
                  value={task.status}
                  disabled={!canWrite || busyId === task.id}
                  onChange={(e) => patch(task, { status: e.target.value })}
                >
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </span>

              <span className={`bc-due due-${dueTone(task.days_left, task.status)}`}>
                <input
                  type="date"
                  value={task.due_date || ''}
                  disabled={!canWrite || busyId === task.id}
                  onChange={(e) => patch(task, { due_date: e.target.value || null })}
                  title={dueText(task.due_date, task.days_left)}
                />
              </span>

              <span className="bc-people">
                {task.assignees.length === 0
                  ? <span className="board-muted">—</span>
                  : task.assignees.map((a) => (
                    <span key={a.id} className="board-person" title={a.name}>{a.name}</span>
                  ))}
              </span>

              <span className="bc-actions">
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
          ))}

          {addingUnder !== undefined && (
            <div className={`board-row board-draft depth-${addingUnder ? 1 : 0}`}>
              <span className="bc-name">
                <span className="board-twisty is-empty" />
                <input
                  ref={draftRef}
                  type="text"
                  value={draftName}
                  placeholder={addingUnder ? '하위 작업 이름' : '작업 이름'}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addTask(addingUnder); }
                    if (e.key === 'Escape') { e.preventDefault(); setAddingUnder(undefined); setDraftName(''); }
                  }}
                />
              </span>
              <span className="bc-draft-actions">
                <button type="button" className="btn-primary" onClick={() => addTask(addingUnder)} disabled={!draftName.trim()}>
                  추가
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setAddingUnder(undefined); setDraftName(''); }}>
                  닫기
                </button>
              </span>
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
