import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Loader2 } from '../../utils/icons';
import {
  getBoard, createBoardTask, updateBoardTask, deleteBoardTask, reorderBoardTasks, renameFile,
} from '../../api';
import { useDialog } from '../../context/DialogContext';
import TaskRow from './TaskRow';

export {
  PRIORITIES, STATUSES, dueTone, remainingText, periodText, shortStamp, fullStamp,
  initialOf, colorForName, Avatar, PillSelect,
} from './TaskRow';

export default function BoardPane({ file, onDirty, onRenamed, onOpenDocument }) {
  const { showConfirm, showAlert } = useDialog();
  const [board, setBoard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);

  // `null` means the row being typed sits at the end of the board; a task id
  // means it sits directly under that task, which is where a sub-item goes.
  const [draftUnder, setDraftUnder] = useState(undefined);
  const [draftName, setDraftName] = useState('');
  const draftRef = useRef(null);
  const addingRef = useRef(false);

  const [title, setTitle] = useState(file.name);
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

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

  const canWrite = board?.can_write !== false;
  const tasks = useMemo(() => board?.tasks || [], [board]);
  const people = board?.assignable_users || [];

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
      title: '할 일 삭제',
      message: kids
        ? `'${task.name}' 할 일과 하위 할 일 ${kids}개를 삭제하시겠습니까?\n할 일은 휴지통을 거치지 않고 바로 지워집니다.`
        : `'${task.name}' 할 일을 삭제하시겠습니까?\n할 일은 휴지통을 거치지 않고 바로 지워집니다.`,
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

  const toggleCollapse = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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

  const dragPropsFor = (task) => (canWrite ? {
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
      <div className="bd-f-name">
        <span className="bd-twisty is-empty" />
        <input
          ref={draftRef}
          type="text"
          value={draftName}
          placeholder={parentId ? '하위 할 일 이름' : '할 일 이름'}
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
      <div className="bd-draft-actions">
        <button type="button" className="btn-primary" onClick={() => addTask(parentId)} disabled={!draftName.trim()}>추가</button>
        <button type="button" className="btn-secondary" onClick={() => { setDraftUnder(undefined); setDraftName(''); }}>닫기</button>
        <span className="bd-draft-hint">Enter로 계속 추가</span>
      </div>
    </div>
  );

  // A 할 일 is its document: opening one opens that document in a window of
  // its own, with everything a document can do, rather than a smaller editor
  // built into the board.
  const openDocument = (task) => {
    if (!task.document_id) return;
    onOpenDocument?.({
      id: task.document_id,
      name: task.name,
      file_type: 'note',
      is_markdown: true,
      folder_id: file.folder_id,
      workspace_id: file.workspace_id,
    });
  };

  const renderTask = (task, depth) => {
    const kids = childrenOf.get(task.id) || [];
    const isCollapsed = collapsed.has(task.id);
    return (
      <React.Fragment key={task.id}>
        <TaskRow
          task={task}
          depth={depth}
          childCount={kids.length}
          collapsed={isCollapsed}
          canWrite={canWrite}
          busy={busyId === task.id}
          people={people}
          assigneeLocked={!!board?.assignee_locked}
          onToggleCollapse={toggleCollapse}
          onOpen={openDocument}
          onPatch={patch}
          onDelete={removeTask}
          onAddSub={depth === 0 ? (t) => { setDraftUnder(t.id); setDraftName(''); } : undefined}
          dragProps={dragPropsFor(task)}
          isDragging={dragId === task.id}
          isDropTarget={dropTarget === task.id}
        />
        {!isCollapsed && kids.map((kid) => renderTask(kid, 1))}
        {!isCollapsed && draftUnder === task.id && renderDraft(task.id)}
      </React.Fragment>
    );
  };

  if (isLoading) return <div className="bd-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>;
  if (error) return <div className="bd-empty"><span>{error}</span></div>;

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  // A flat total counted a sub-item as another 할 일, so a board of two things
  // with four steps each read as ten.
  const topCount = tasks.filter((t) => !t.parent_task_id).length;
  const subCount = tasks.length - topCount;

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
        {/* No "add" button here: the table already ends with a row that does
            it, in the place the new row appears. Two ways to do one thing, one
            of them far from its result, is one too many. */}
        <span className="bd-header-stat">
          할 일 {topCount}개{subCount > 0 && ` · 하위 ${subCount}개`}
          {doneCount > 0 && <span className="bd-header-done"> · 완료 {doneCount}</span>}
        </span>
      </div>

      <div className="bd-scroll">
        {/* The same card the 일정 탭 groups tasks in, so a board and the
            workspace-wide list are recognisably the same thing. */}
        <section className="sc-group bd-group">
        <div className="bd-table">
          <div className="bd-row bd-head" aria-hidden="true">
            <div className="bd-f-name">할 일</div>
            <div className="bd-f-status">진행 상태</div>
            <div className="bd-f-priority">중요도</div>
            <div className="bd-f-people">담당자</div>
            <div className="bd-f-period">기간</div>
            <div className="bd-f-stamps">생성 · 수정</div>
            <div className="bd-f-actions" />
          </div>

          {topLevel.length === 0 && draftUnder === undefined && (
            <div className="bd-empty-row">아직 할 일이 없습니다. ‘새 할 일’으로 시작해 보세요.</div>
          )}

          {topLevel.map((task) => renderTask(task, 0))}
          {draftUnder === null && renderDraft(null)}

          {canWrite && draftUnder !== null && (
            <button type="button" className="bd-addrow" onClick={() => { setDraftUnder(null); setDraftName(''); }}>
              <Plus size={13} /><span>할 일 추가</span>
            </button>
          )}
        </div>
        </section>
        {!canWrite && <div className="bd-readonly">읽기 전용입니다. 이 폴더에 쓰기 권한이 없습니다.</div>}
      </div>

    </div>
  );
}
