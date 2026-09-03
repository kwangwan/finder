import React from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Filter } from '../../utils/icons';
import { Dropdown, DateRangeField, Toggle } from './controls';

export const GROUPINGS = [
  { value: 'urgency', label: '기한순' },
  { value: 'board', label: '일정별' },
  { value: 'status', label: '상태별' },
];

export const PRIORITY_OPTIONS = [
  { value: '', label: '중요도 전체' },
  { value: 'urgent', label: '긴급' },
  { value: 'high', label: '높음' },
  { value: 'normal', label: '보통' },
  { value: 'low', label: '낮음' },
];

export const STATUS_OPTIONS = [
  { value: '', label: '상태 전체' },
  { value: 'todo', label: '대기' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'review', label: '검토' },
  { value: 'done', label: '완료' },
  { value: 'hold', label: '보류' },
];

/**
 * What the list shows when nobody has changed anything: everything in the
 * workspace. It used to open on "내 담당만", which answered a narrower question
 * than the tab is for — the 일정 탭 is where the whole workspace's work is —
 * and hid other people's deadlines from the person most likely to be looking
 * for them. Whose work to look at is now a choice, with yourself at the top.
 */
export const DEFAULT_FILTERS = {
  grouping: 'urgency',
  assigneeId: '',
  // Kept beside the id so the chip can say whose work is being shown without
  // the bar having to hold the list of people to look the name up in.
  assigneeName: '',
  includeDone: false,
  priority: '',
  status: '',
  fromDate: null,
  toDate: null,
};

/** The filters that are not at their default, as chips the bar can show. */
export function activeFilters(f) {
  const out = [];
  if (f.grouping !== DEFAULT_FILTERS.grouping) {
    out.push({ key: 'grouping', label: GROUPINGS.find((g) => g.value === f.grouping)?.label, reset: { grouping: DEFAULT_FILTERS.grouping } });
  }
  if (f.assigneeId) {
    out.push({ key: 'assignee', label: `담당: ${f.assigneeName || '선택한 사람'}`, reset: { assigneeId: '', assigneeName: '' } });
  }
  if (f.includeDone) out.push({ key: 'includeDone', label: '완료도 함께', reset: { includeDone: false } });
  if (f.priority) {
    out.push({ key: 'priority', label: PRIORITY_OPTIONS.find((p) => p.value === f.priority)?.label, reset: { priority: '' } });
  }
  if (f.status) {
    out.push({ key: 'status', label: STATUS_OPTIONS.find((s) => s.value === f.status)?.label, reset: { status: '' } });
  }
  if (f.fromDate || f.toDate) {
    const day = (v) => (v ? `${Number(v.slice(5, 7))}월 ${Number(v.slice(8, 10))}일` : '');
    const label = f.fromDate && f.toDate
      ? (f.fromDate === f.toDate ? day(f.fromDate) : `${day(f.fromDate)} – ${day(f.toDate)}`)
      : (f.fromDate ? `${day(f.fromDate)}부터` : `${day(f.toDate)}까지`);
    out.push({ key: 'period', label, reset: { fromDate: null, toDate: null } });
  }
  return out;
}

/**
 * The filters, put away.
 *
 * Seven controls across the top said everything at once and meant nothing at
 * a glance — the list itself is what the screen is for. They live here now,
 * behind one button that says how many are on, and what is on is shown back
 * as chips beside it so nothing is hidden, only tidied.
 */
export default function ScheduleFilterModal({ isOpen, filters, onChange, onClose, people = [], currentUserId = null }) {
  if (!isOpen) return null;
  const set = (patch) => onChange({ ...filters, ...patch });

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 1500 }} onClick={onClose}>
      <div className="modal-content modal-self-padded sf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sf-head">
          <Filter size={16} color="var(--accent-primary)" />
          <h2>보기 설정</h2>
          <button type="button" className="btn-icon" onClick={onClose} title="닫기"><X size={17} /></button>
        </div>

        <div className="sf-body">
          <div className="sf-row">
            <span className="sf-label">묶는 기준</span>
            <div className="sf-control">
              <div className="sc-groupby" role="group" aria-label="묶는 기준">
                {GROUPINGS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    className={filters.grouping === g.value ? 'on' : ''}
                    onClick={() => set({ grouping: g.value })}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="sf-row">
            <span className="sf-label">담당자</span>
            <div className="sf-control">
              <Dropdown
                value={filters.assigneeId || ''}
                label="담당자로 거르기"
                options={[
                  { value: '', label: '담당자 전체' },
                  ...people.map((p) => ({ value: p.id, label: p.id === currentUserId ? `${p.name} (나)` : p.name })),
                ]}
                onChange={(v) => set({
                  assigneeId: v,
                  assigneeName: people.find((p) => p.id === v)?.name || '',
                })}
                className="sf-wide"
              />
            </div>
          </div>

          <div className="sf-row">
            <span className="sf-label">완료</span>
            <div className="sf-control">
              <Toggle
                on={filters.includeDone}
                onChange={(v) => set({ includeDone: v })}
                onLabel="완료도 함께 보는 중"
                offLabel="완료는 숨기는 중"
                title="완료한 할 일을 목록에 포함할지"
              />
              <small>상위 할 일이 완료면 그 아래 하위 할 일까지 함께 숨깁니다.</small>
            </div>
          </div>

          <div className="sf-row">
            <span className="sf-label">중요도</span>
            <div className="sf-control">
              <Dropdown
                value={filters.priority}
                label="중요도로 거르기"
                options={PRIORITY_OPTIONS}
                onChange={(v) => set({ priority: v })}
                className="sf-wide"
              />
            </div>
          </div>

          <div className="sf-row">
            <span className="sf-label">진행 상태</span>
            <div className="sf-control">
              <Dropdown
                value={filters.status}
                label="진행 상태로 거르기"
                options={STATUS_OPTIONS}
                onChange={(v) => set({ status: v })}
                className="sf-wide"
              />
            </div>
          </div>

          <div className="sf-row">
            <span className="sf-label">기간</span>
            <div className="sf-control">
              {/* Matches anything whose period touches the range, so something
                  running from last month into next still shows up in a week it
                  is actually running through. */}
              <DateRangeField
                start={filters.fromDate}
                end={filters.toDate}
                placeholder="기간 전체"
                onChange={(a, b) => set({ fromDate: a, toDate: b })}
              />
            </div>
          </div>
        </div>

        <div className="sf-actions">
          <button type="button" className="btn-secondary" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
            <RotateCcw size={13} /><span>기본값으로</span>
          </button>
          <span className="sf-spacer" />
          <button type="button" className="btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
