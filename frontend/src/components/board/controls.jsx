import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Check, X, Calendar } from '../../utils/icons';

/**
 * A dropdown that looks like the rest of the app.
 *
 * A native <select> paints the operating system's own list — white rows and a
 * system font dropped into a themed page — which is exactly what the filter
 * bar looked like before.
 */
export function Dropdown({ value, options, onChange, label, className = '', width }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [open]);

  const current = options.find((o) => o.value === value) || options[0];
  return (
    <span className={`ui-dd ${className}`} ref={ref} style={width ? { width } : undefined}>
      <button
        type="button"
        className={`ui-dd-btn ${value ? 'is-set' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ui-dd-label">{current?.label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <span className="ui-dd-menu" role="listbox">
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={o.value === value ? 'on' : ''}
              onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={12} />}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parse(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A calendar the range is clicked out on.
 *
 * Two native date fields are a form to fill in, not a period to choose: you
 * cannot see where the days fall relative to each other, which is the whole
 * question when picking a start and an end. First click sets the start, second
 * the end, and clicking before the start begins again from there.
 */
export function DateRangePicker({ start, end, onChange, onClose, allowClear = true }) {
  const startDate = parse(start);
  const endDate = parse(end);
  const [cursor, setCursor] = useState(() => startDate || endDate || new Date());
  const [pendingStart, setPendingStart] = useState(null);
  const [hover, setHover] = useState(null);

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;                  // weeks start on Monday
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let d = 1; d <= total; d += 1) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    return cells;
  }, [cursor]);

  const rangeStart = pendingStart || startDate;
  const rangeEnd = pendingStart ? (hover || null) : endDate;

  const inRange = (d) => {
    if (!rangeStart || !rangeEnd) return false;
    const [a, b] = rangeStart <= rangeEnd ? [rangeStart, rangeEnd] : [rangeEnd, rangeStart];
    return d > a && d < b;
  };

  const pick = (d) => {
    if (!pendingStart) { setPendingStart(d); setHover(null); return; }
    // Clicking before the start is read as starting again from there rather
    // than as an inverted range, which is never what someone means.
    if (d < pendingStart) { setPendingStart(d); return; }
    onChange(iso(pendingStart), iso(d));
    setPendingStart(null);
    onClose?.();
  };

  const today = new Date();
  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;

  return (
    <div className="ui-cal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ui-cal-head">
        <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} title="이전 달">
          <ChevronLeft size={14} />
        </button>
        <span>{monthLabel}</span>
        <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} title="다음 달">
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="ui-cal-grid">
        {WEEKDAYS.map((w) => <span key={w} className="ui-cal-wd">{w}</span>)}
        {days.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const isStart = sameDay(d, rangeStart);
          const isEnd = sameDay(d, rangeEnd) || (!pendingStart && sameDay(d, endDate));
          return (
            <button
              key={iso(d)}
              type="button"
              className={`ui-cal-day ${isStart ? 'is-start' : ''} ${isEnd ? 'is-end' : ''} ${inRange(d) ? 'in-range' : ''} ${sameDay(d, today) ? 'is-today' : ''}`}
              onMouseEnter={() => pendingStart && setHover(d)}
              onClick={() => pick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className="ui-cal-foot">
        <span className="ui-cal-hint">
          {pendingStart ? '종료일을 고르세요' : '시작일을 고르세요'}
        </span>
        <button type="button" onClick={() => { const t = iso(new Date()); onChange(t, t); onClose?.(); }}>오늘</button>
        {allowClear && (
          <button type="button" onClick={() => { onChange(null, null); setPendingStart(null); onClose?.(); }}>
            <X size={11} /> 지우기
          </button>
        )}
      </div>
    </div>
  );
}

/** A button that opens the calendar, showing the chosen range as a phrase. */
export function DateRangeField({ start, end, onChange, disabled, placeholder = '기간 선택', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [open]);

  const label = (() => {
    if (!start && !end) return placeholder;
    const fmt = (v) => { const d = parse(v); return d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : ''; };
    if (start && end) return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
    return start ? `${fmt(start)}부터` : `${fmt(end)}까지`;
  })();

  return (
    <span className={`ui-dd ${className}`} ref={ref}>
      <button
        type="button"
        className={`ui-dd-btn ${start || end ? 'is-set' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Calendar size={12} />
        <span className="ui-dd-label">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <span className="ui-dd-pop">
          <DateRangePicker
            start={start}
            end={end}
            onChange={(a, b) => onChange(a, b)}
            onClose={() => setOpen(false)}
          />
        </span>
      )}
    </span>
  );
}

/** A switch that says what it is doing now, not what it might do. */
export function Toggle({ on, onChange, onLabel, offLabel, title }) {
  return (
    <button
      type="button"
      className={`ui-toggle ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
    >
      <span className="ui-toggle-dot" />
      <span>{on ? onLabel : offLabel}</span>
    </button>
  );
}
