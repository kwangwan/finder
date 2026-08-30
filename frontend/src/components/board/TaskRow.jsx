import React, { useRef, useState } from 'react';
import {
  Plus, Trash2, ChevronRight, ChevronDown, Calendar, GripVertical, Check, FileText,
  ExternalLink, FolderOpen,
} from '../../utils/icons';
import { DateRangePicker, Popover } from './controls';

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

// Faces first, then a count. Enough of them to see at a glance that several
// people are on something, without the column growing without limit.
const AVATARS_SHOWN = 3;

export function dueTone(daysLeft, status) {
  if (status === 'done') return 'done';
  if (daysLeft === null || daysLeft === undefined) return 'none';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= 3) return 'soon';
  return 'later';
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * A date the way it gets said out loud, weekday included.
 *
 * Which day of the week something falls on is half of what a deadline means —
 * "9월 5일" says little until you know it is a Friday.
 */
function dayLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = Number.isNaN(date.getTime()) ? '' : ` (${WEEKDAYS[date.getDay()]})`;
  return `${m}월 ${d}일${weekday}`;
}

export function remainingText(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft < 0) return `${-daysLeft}일 지남`;
  if (daysLeft === 0) return '오늘';
  return `${daysLeft}일 남음`;
}

export function periodText(startDate, dueDate) {
  if (!startDate && !dueDate) return '기간 설정';
  // One day is a day, not a range from itself to itself.
  if (startDate && dueDate) {
    return startDate === dueDate ? dayLabel(dueDate) : `${dayLabel(startDate)} – ${dayLabel(dueDate)}`;
  }
  return dueDate ? `${dayLabel(dueDate)}까지` : `${dayLabel(startDate)}부터`;
}

export function shortStamp(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function fullStamp(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hour = d.getHours();
  const half = hour < 12 ? '오전' : '오후';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]}) `
    + `${half} ${twelve}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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

/** A person's photo, falling back to the initial of their name. */
export function Avatar({ person, size = 22, className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = person?.avatar;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (src && !failed) {
    return (
      <img
        className={`bd-avatar ${className}`}
        style={style}
        src={src}
        alt={person.name}
        title={person.name}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={`bd-avatar ${className}`}
      style={{ ...style, background: colorForName(person?.name) }}
      title={person?.name}
    >
      {initialOf(person?.name)}
    </span>
  );
}

/**
 * A dropdown that looks the same everywhere.
 *
 * A native <select> paints the operating system's own list — white rows and a
 * system font in the middle of a dark, themed board — and cannot show a colour
 * against each choice, which is the whole point of these two columns.
 */
export function PillSelect({ value, options, onChange, disabled, kind, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const current = options.find((o) => o.value === value) || options[0];
  return (
    <span className="bd-pillwrap" ref={ref}>
      <button
        type="button"
        className={`bd-pill ${kind}-${value}`}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        {current?.label}
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} className="bd-pill-menu">
          <span role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`bd-pill ${kind}-${o.value} ${o.value === value ? 'is-current' : ''}`}
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (o.value !== value) onChange(o.value); }}
            >
              {o.label}
              {o.value === value && <Check size={12} />}
            </button>
          ))}
          </span>
        </Popover>
      )}
    </span>
  );
}

/**
 * One task, in the board and in the workspace-wide list alike.
 *
 * Laid out as a grid whose areas change with the *container's* width, not the
 * window's — the board lives inside a window the user can resize, so a media
 * query would answer the wrong question. Wide: one line, columns aligned down
 * the page. Narrower: two lines, then three. Nothing ever scrolls sideways,
 * and the name is never the thing that gets squeezed out.
 */
export default function TaskRow({
  task,
  depth = 0,
  childCount = 0,
  collapsed = false,
  canWrite = true,
  busy = false,
  people = [],
  showBoardName = false,
  isOpen = false,
  onToggleCollapse,
  onOpen,
  onPatch,
  onDelete,
  onAddSub,
  dragProps = {},
  isDragging = false,
  isDropTarget = false,
  onHover,
  onOpenBoardWindow,
  onOpenFolderWindow,
}) {
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const peopleRef = useRef(null);
  const periodRef = useRef(null);

  const tone = dueTone(task.days_left, task.status);
  const left = remainingText(task.days_left);

  const toggleAssignee = (userId) => {
    const current = task.assignees.map((a) => a.id);
    onPatch(task, {
      assignee_ids: current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    });
  };

  return (
    <div
      className={`bd-row depth-${depth} tone-${tone} ${isOpen ? 'is-open' : ''} ${task.status === 'done' ? 'is-done' : ''} ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop' : ''}`}
      onMouseEnter={onHover}
      {...dragProps}
    >
      <div className="bd-f-name">
        {canWrite && <span className="bd-grip" title="끌어서 순서 변경"><GripVertical size={12} /></span>}
        {depth === 0 ? (
          <button
            type="button"
            className={`bd-twisty ${childCount ? '' : 'is-empty'}`}
            onClick={() => childCount && onToggleCollapse?.(task.id)}
            tabIndex={childCount ? 0 : -1}
            title={childCount ? (collapsed ? '하위 할 일 펼치기' : '하위 할 일 접기') : undefined}
          >
            {childCount ? (collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />) : null}
          </button>
        ) : <span className="bd-twisty is-empty" />}
        <button
          type="button"
          className="bd-name"
          onClick={() => onOpen?.(task)}
          title={`${task.name} — 이 할 일의 문서 열기`}
        >
          {task.name}
        </button>
        {childCount > 0 && <span className="bd-subcount" title={`하위 할 일 ${childCount}개`}>{childCount}</span>}

        {/* Every 할 일 has a document. Filled in once something is written in
            it, so a glance down the column says which ones have a record. */}
        <button
          type="button"
          className={`bd-note ${task.has_detail ? 'has' : ''}`}
          onClick={() => onOpen?.(task)}
          title={task.has_detail ? '이 할 일의 문서 열기' : '이 할 일의 문서에 기록 남기기'}
        >
          <FileText size={12} />
        </button>

        {canWrite && depth === 0 && onAddSub && (
          <button type="button" className="bd-subadd" title="하위 할 일 추가" onClick={() => onAddSub(task)}>
            <Plus size={12} />
          </button>
        )}

        {showBoardName && task.board?.name && <span className="bd-rowboard">{task.board.name}</span>}
      </div>

      <div className="bd-f-status">
        <PillSelect
          kind="status" label="진행 상태" value={task.status} options={STATUSES}
          disabled={!canWrite || busy}
          onChange={(v) => onPatch(task, { status: v })}
        />
      </div>

      <div className="bd-f-priority">
        <PillSelect
          kind="priority" label="중요도" value={task.priority} options={PRIORITIES}
          disabled={!canWrite || busy}
          onChange={(v) => onPatch(task, { priority: v })}
        />
      </div>

      <div className="bd-f-people">
        <button
          type="button"
          ref={peopleRef}
          className="bd-people"
          disabled={!canWrite}
          onClick={() => setPeopleOpen((v) => !v)}
          title={task.assignees.map((a) => a.name).join(', ') || '담당자 지정'}
        >
          {task.assignees.length === 0
            ? (
              // An icon rather than a "+" character: the glyph centres on the
              // font's maths axis, which left it sitting low in the circle.
              <span className="bd-avatar is-empty" style={{ width: 22, height: 22 }}><Plus size={11} /></span>
            )
            : task.assignees.slice(0, AVATARS_SHOWN).map((a) => <Avatar key={a.id} person={a} />)}
          {task.assignees.length > AVATARS_SHOWN && (
            <span className="bd-avatar is-more" style={{ width: 22, height: 22 }}>
              +{task.assignees.length - AVATARS_SHOWN}
            </span>
          )}
        </button>
        {/* Anchored to the button, not to the column cell it sits in: the cell
            spans the whole column, so a right-aligned menu landed at the far
            edge of it, hundreds of pixels from what was clicked. */}
        {peopleOpen && (
          <Popover anchorRef={peopleRef} onClose={() => setPeopleOpen(false)} className="bd-people-pop">
            {people.length === 0 && <div className="bd-pop-empty">지정할 수 있는 사람이 없습니다.</div>}
            {people.map((u) => {
              const on = task.assignees.some((a) => a.id === u.id);
              return (
                <button key={u.id} type="button" className={on ? 'on' : ''} onClick={() => toggleAssignee(u.id)}>
                  <Avatar person={u} size={20} />
                  <span className="bd-pop-name">{u.name}</span>
                  {on && <Check size={12} />}
                </button>
              );
            })}
          </Popover>
        )}
      </div>

      <div className={`bd-f-period due-${tone}`} ref={periodRef}>
        <button
          type="button" className="bd-period"
          disabled={!canWrite || busy}
          onClick={() => setEditingPeriod((v) => !v)}
          title={canWrite ? '달력에서 기간 고르기' : '기간'}
        >
          <Calendar size={11} />
          <span className="bd-period-text">{periodText(task.start_date, task.due_date)}</span>
          {left && <span className="bd-remaining">{left}</span>}
        </button>
        {/* Clicked out on a calendar rather than typed into two date fields:
            picking a start and an end is a question about where the days fall
            relative to each other, which a pair of text boxes cannot show. */}
        {editingPeriod && (
          <Popover anchorRef={periodRef} onClose={() => setEditingPeriod(false)} className="bd-period-pop">
            <DateRangePicker
              start={task.start_date}
              end={task.due_date}
              onChange={(from, to) => onPatch(task, { start_date: from, due_date: to })}
              onClose={() => setEditingPeriod(false)}
            />
          </Popover>
        )}
      </div>

      <div className="bd-f-stamps">
        <span title={`만든 날 ${fullStamp(task.created_at)}`}>만듦 {shortStamp(task.created_at)}</span>
        <span title={`마지막 수정 ${fullStamp(task.updated_at)}${task.last_edited_by_name ? ` · ${task.last_edited_by_name}` : ''}`}>
          수정 {shortStamp(task.updated_at)}
        </span>
      </div>

      <div className="bd-f-actions">
        {onOpenBoardWindow && (
          <button type="button" className="btn-icon" title="이 일정을 새 창에서 열기" onClick={() => onOpenBoardWindow(task)}>
            <ExternalLink size={13} />
          </button>
        )}
        {onOpenFolderWindow && (
          <button type="button" className="btn-icon" title="이 일정이 있는 폴더를 새 창에서 열기" onClick={() => onOpenFolderWindow(task)}>
            <FolderOpen size={13} />
          </button>
        )}
        {canWrite && onDelete && (
          <button type="button" className="btn-icon" title="할 일 삭제" onClick={() => onDelete(task)}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
