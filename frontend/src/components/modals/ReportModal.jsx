import React, { useEffect, useState } from 'react';
import { Flag, X, Loader2 } from '../../utils/icons';
import { getReportReasons, reportContent } from '../../api';

/**
 * Report something that does not belong in a shared space.
 *
 * A category is required and the note is optional: the category is what makes
 * a queue sortable, while forcing someone to write an explanation is what
 * stops them reporting at all.
 */
export default function ReportModal({ isOpen, file, onClose, onDone }) {
  const [reasons, setReasons] = useState([]);
  const [reason, setReason] = useState('inappropriate');
  const [detail, setDetail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setReason('inappropriate'); setDetail(''); setError(''); setDone(null);
    getReportReasons().then(r => setReasons(r.reasons || [])).catch(() => setReasons([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !file) return null;

  const submit = async () => {
    setIsSending(true);
    setError('');
    try {
      const res = await reportContent(file.id, reason, detail);
      setDone(res.already_reported ? 'already' : 'ok');
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-content dialog-modal modal-self-padded"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 460, width: '92vw', padding: 0, overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}
      >
        <div className="dialog-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <div style={{
              width: 38, height: 38, borderRadius: 'var(--radius-md)', flexShrink: 0,
              background: 'rgba(239, 68, 68, 0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Flag size={18} color="var(--accent-rose)" />
            </div>
            <h3 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              신고하기
            </h3>
            <button className="btn-icon" onClick={onClose} title="닫기 (ESC)" style={{ padding: '0.25rem', color: 'var(--text-muted)' }}>
              <X size={16} />
            </button>
          </div>

          {done ? (
            <div style={{ marginTop: '0.9rem', fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>
              {done === 'already'
                ? '이미 이 파일을 신고하셨습니다. 관리자가 확인 중입니다.'
                : '신고가 접수되었습니다. 관리자가 확인 후 처리합니다.'}
              <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                신고만으로는 파일이 삭제되지 않으며, 관리자가 직접 확인합니다.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '0.8rem' }}>
              <div style={{
                padding: '0.5rem 0.7rem', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)', fontSize: '0.84rem', fontWeight: 600,
                color: 'var(--text-primary)', wordBreak: 'keep-all', overflowWrap: 'anywhere', marginBottom: '0.7rem'
              }}>
                {file.name}
              </div>

              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>
                신고 사유
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.7rem' }}>
                {reasons.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    className={`report-reason-pick ${reason === r.value ? 'active' : ''}`}
                    onClick={() => setReason(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5 }}>
                상세 내용 (선택)
              </label>
              <textarea
                className="input-field"
                rows={3}
                maxLength={2000}
                value={detail}
                onChange={e => setDetail(e.target.value)}
                placeholder="관리자가 판단하는 데 도움이 될 내용을 적어주세요."
                style={{ resize: 'vertical' }}
              />
              {error && <div style={{ marginTop: 6, fontSize: '0.76rem', color: 'var(--accent-rose)' }}>{error}</div>}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {done ? (
            <button type="button" className="btn-primary" onClick={onClose}>확인</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
              <button type="button" className="btn-danger" onClick={submit} disabled={isSending}>
                {isSending ? <Loader2 size={14} className="spin" /> : <Flag size={14} />}
                <span>신고</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
