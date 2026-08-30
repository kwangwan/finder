import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, AtSign, ChevronLeft, ChevronRight, Loader2,
} from '../../utils/icons';
import { getUsernameHistory } from '../../api';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function stamp(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hour = d.getHours();
  const half = hour < 12 ? '오전' : '오후';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]}) `
    + `${half} ${twelve}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * What this account has called itself, and when.
 *
 * A handle is how work is attributed, so it must be possible to ask whether
 * the person who uploaded something last year was always called this. Paged,
 * because somebody who renames often would otherwise push the entries that
 * matter off the end of a fixed list.
 */
export default function UsernameHistoryModal({ userId, isOpen, onClose }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => { if (isOpen) setPage(1); }, [isOpen, userId]);

  useEffect(() => {
    if (!isOpen || !userId) return;
    setIsLoading(true);
    getUsernameHistory(userId, page)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setIsLoading(false));
  }, [isOpen, userId, page]);

  if (!isOpen) return null;

  const items = data?.items || [];

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 1600 }} onClick={onClose}>
      <div className="modal-content modal-self-padded uh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="uh-head">
          <AtSign size={16} color="var(--accent-primary)" />
          <div className="uh-title">
            <span>아이디 변경 이력</span>
            {data?.user && (
              <small>
                {data.user.name ? `${data.user.name} ` : ''}
                @{data.user.username}
              </small>
            )}
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="닫기"><X size={17} /></button>
        </div>

        <div className="uh-body">
          {isLoading && items.length === 0 ? (
            <div className="uh-empty"><Loader2 size={16} className="spin" /><span>불러오는 중...</span></div>
          ) : items.length === 0 ? (
            <div className="uh-empty"><span>기록이 없습니다.</span></div>
          ) : items.map((row) => (
            <div key={`${row.username}-${row.taken_at}`} className={`uh-row ${row.is_current ? 'is-current' : ''}`}>
              <span className="uh-name">
                @{row.username}
                {row.is_current && <span className="uh-badge">현재</span>}
              </span>
              <span className="uh-when">
                <span>{stamp(row.taken_at)}부터</span>
                <span>{row.released_at ? `${stamp(row.released_at)}까지` : '쓰는 중'}</span>
              </span>
            </div>
          ))}
        </div>

        {(data?.total_pages || 1) > 1 && (
          <div className="uh-pager">
            <button type="button" className="btn-icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={15} />
            </button>
            <span>{page} / {data.total_pages}</span>
            <button type="button" className="btn-icon" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        <div className="uh-actions">
          <span className="uh-note">아이디는 30일에 한 번 바꿀 수 있고, 바꾼 아이디는 180일 동안 다른 사람이 쓸 수 없습니다.</span>
          <button type="button" className="btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
