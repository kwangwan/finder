import React, { useEffect, useState } from 'react';
import { X, Loader2, Mail, Check, AlertTriangle } from '../../utils/icons';
import { getDigestSettings, saveDigestSettings, sendTestDigest } from '../../api';
import { useDialog } from '../../context/DialogContext';

/**
 * When the daily deadline mail goes out, and by whose clock.
 *
 * One setting for the whole workspace rather than a preference per person:
 * a deadline is the same moment for everyone working to it, and letting each
 * person pick their own "today" would make two people reading the same board
 * disagree about what is due.
 */
export default function DigestSettingsModal({ workspaceId, workspaceName, isOpen, onClose }) {
  const { showAlert } = useDialog();
  const [config, setConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!isOpen || !workspaceId) return;
    let cancelled = false;
    setIsLoading(true);
    getDigestSettings(workspaceId)
      .then((res) => { if (!cancelled) setConfig(res); })
      .catch(async (e) => { if (!cancelled) await showAlert({ title: '불러오지 못했습니다', message: e.message, type: 'error' }); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workspaceId]);

  if (!isOpen) return null;

  const canEdit = !!config?.can_edit;
  const set = (patch) => setConfig((prev) => ({ ...prev, ...patch }));

  const toggleHorizon = (value) => {
    const current = config.horizons || [];
    set({ horizons: current.includes(value) ? current.filter((h) => h !== value) : [...current, value] });
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const saved = await saveDigestSettings(workspaceId, {
        enabled: config.enabled,
        utc_offset_hours: config.utc_offset_hours,
        send_hour: config.send_hour,
        send_minute: config.send_minute,
        horizons: config.horizons,
      });
      setConfig((prev) => ({ ...prev, ...saved }));
      onClose(true);
    } catch (e) {
      await showAlert({ title: '저장하지 못했습니다', message: e.message, type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const test = async () => {
    setIsTesting(true);
    try {
      const res = await sendTestDigest(workspaceId);
      await showAlert({
        title: res.sent ? '보냈습니다' : '보내지 않았습니다',
        message: res.sent
          ? `${res.to} 주소로 미리보기를 보냈습니다.`
          : (res.reason || '메일을 보내지 못했습니다.'),
        type: res.sent ? 'success' : 'warning',
      });
    } catch (e) {
      await showAlert({ title: '보내지 못했습니다', message: e.message, type: 'error' });
    } finally {
      setIsTesting(false);
    }
  };

  const pad = (n) => String(n).padStart(2, '0');

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal-content modal-self-padded digest-modal" onClick={(e) => e.stopPropagation()}>
        <div className="digest-head">
          <Mail size={18} color="var(--accent-primary)" />
          <h2>일정 알림 설정</h2>
          <button type="button" className="btn-icon" onClick={() => onClose(false)} title="닫기"><X size={17} /></button>
        </div>

        {isLoading || !config ? (
          <div className="board-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>
        ) : (
          <>
            <p className="digest-intro">
              <strong>{workspaceName}</strong>의 모든 이용자에게 적용됩니다. 각자에게 배정된 작업만
              담아 개인별로 발송됩니다.
            </p>

            {!config.email_configured && (
              <div className="digest-warn">
                <AlertTriangle size={14} />
                <span>메일 발송이 아직 설정되지 않아 실제로는 보내지지 않습니다.</span>
              </div>
            )}

            <label className="digest-switch">
              <input
                type="checkbox"
                checked={!!config.enabled}
                disabled={!canEdit}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              <span>매일 알림 메일 보내기</span>
            </label>

            <div className="digest-grid">
              <label>
                <span>기준시</span>
                <select
                  value={config.utc_offset_hours}
                  disabled={!canEdit}
                  onChange={(e) => set({ utc_offset_hours: Number(e.target.value) })}
                >
                  {(config.timezone_choices || []).map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
                <small>‘오늘’과 ‘이번 주’를 판단하는 기준입니다.</small>
              </label>

              <label>
                <span>발송 시각</span>
                <span className="digest-time">
                  <select
                    value={config.send_hour}
                    disabled={!canEdit}
                    onChange={(e) => set({ send_hour: Number(e.target.value) })}
                  >
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}시</option>)}
                  </select>
                  <select
                    value={config.send_minute}
                    disabled={!canEdit}
                    onChange={(e) => set({ send_minute: Number(e.target.value) })}
                  >
                    {[0, 10, 20, 30, 40, 50].map((m) => <option key={m} value={m}>{pad(m)}분</option>)}
                  </select>
                </span>
                <small>기준시로 매일 이 시각에 한 번 보냅니다.</small>
              </label>
            </div>

            <div className="digest-horizons">
              <span className="digest-label">메일에 담을 기간</span>
              <div className="digest-chips">
                {(config.horizon_choices || []).map((h) => {
                  const on = (config.horizons || []).includes(h.value);
                  return (
                    <button
                      key={h.value}
                      type="button"
                      className={`digest-chip ${on ? 'on' : ''}`}
                      disabled={!canEdit}
                      onClick={() => toggleHorizon(h.value)}
                    >
                      {on && <Check size={11} />}
                      <span>{h.label}</span>
                    </button>
                  );
                })}
              </div>
              <small>기한이 지난 작업은 항상 ‘오늘 중’에 함께 담깁니다.</small>
            </div>

            <div className="digest-actions">
              {canEdit ? (
                <>
                  <button type="button" className="btn-secondary" onClick={test} disabled={isTesting}>
                    {isTesting ? <Loader2 size={13} className="spin" /> : <Mail size={13} />}
                    <span>나에게 미리보기 보내기</span>
                  </button>
                  <span className="digest-spacer" />
                  <button type="button" className="btn-secondary" onClick={() => onClose(false)}>취소</button>
                  <button type="button" className="btn-primary" onClick={save} disabled={isSaving}>
                    {isSaving ? '저장 중...' : '저장'}
                  </button>
                </>
              ) : (
                <>
                  <span className="digest-readonly">설정 변경은 최고 관리자만 할 수 있습니다.</span>
                  <button type="button" className="btn-secondary" onClick={() => onClose(false)}>닫기</button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
