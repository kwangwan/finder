import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, Mail, Check, AlertTriangle, Settings as SettingsIcon } from '../../utils/icons';
import {
  getDigestSettings, saveDigestSettings, saveMyDigestSettings, sendTestDigest,
} from '../../api';
import { useDialog } from '../../context/DialogContext';
import { Dropdown, Toggle } from './controls';

const pad = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${pad(h)}시` }));
const MINUTES = [0, 10, 20, 30, 40, 50].map((m) => ({ value: m, label: `${pad(m)}분` }));

/**
 * The reference clock, and when each person's reminder arrives.
 *
 * Split deliberately: the clock is one setting for the whole workspace, since
 * it decides what "오늘" means on every board — two people disagreeing about
 * which day it is would make their boards disagree. When the mail lands is
 * nobody else's business, so that is each person's own, starting from whatever
 * the administrator set as the default.
 *
 * Every control here saves itself the moment it is used. There used to be a
 * 저장 button, and a switch that says "매일 받는 중" the moment it is flipped
 * reads as already in effect — so a reminder turned on and then closed was
 * never stored at all, and the mail simply never came. Nothing to press, and
 * nothing that can be left unpressed.
 */
export default function DigestSettingsModal({ workspaceId, workspaceName, isOpen, onClose }) {
  const { showAlert } = useDialog();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [tab, setTab] = useState('mine');

  const [mine, setMine] = useState({});
  const [defaults, setDefaults] = useState({});
  // 'idle' | 'saving' | 'saved' | 'failed', so a change that went through says
  // so without a dialog and a change that did not is never mistaken for one
  // that did.
  const [saveState, setSaveState] = useState('idle');
  const savedTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(savedTimerRef.current), []);

  const load = () => {
    setIsLoading(true);
    getDigestSettings(workspaceId)
      .then((res) => {
        setData(res);
        setDefaults(res.defaults);
        setMine(res.effective);
        setTab(res.can_edit_defaults ? 'mine' : 'mine');
      })
      .catch(async (e) => { await showAlert({ title: '불러오지 못했습니다', message: e.message, type: 'error' }); })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (!isOpen || !workspaceId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workspaceId]);

  if (!isOpen) return null;

  const canEditDefaults = !!data?.can_edit_defaults;
  const editing = tab === 'mine' ? mine : defaults;
  const readOnly = tab === 'defaults' && !canEditDefaults;

  const toggleHorizon = (value) => {
    const current = editing.horizons || [];
    const next = current.includes(value) ? current.filter((h) => h !== value) : [...current, value];
    // The mail has to carry something. Turning the last one off would leave a
    // reminder with nothing in it, so the last one stays on.
    if (next.length === 0) return;
    apply({ horizons: next });
  };

  /**
   * Take a change, show it immediately, and send it.
   *
   * The screen is updated first so a dropdown never appears to snap back while
   * the request is in flight; a failure says so and puts the stored value back
   * by re-reading it.
   */
  const apply = async (patch) => {
    if (readOnly) return;
    const isMine = tab === 'mine';
    const next = { ...(isMine ? mine : defaults), ...patch };
    (isMine ? setMine : setDefaults)(next);
    setSaveState('saving');
    clearTimeout(savedTimerRef.current);
    try {
      if (isMine) {
        await saveMyDigestSettings(workspaceId, {
          enabled: next.enabled,
          send_hour: next.send_hour,
          send_minute: next.send_minute,
          horizons: next.horizons,
        });
      } else {
        await saveDigestSettings(workspaceId, {
          enabled: next.enabled,
          timezone: next.timezone,
          send_hour: next.send_hour,
          send_minute: next.send_minute,
          horizons: next.horizons,
        });
      }
      // The two tabs are not independent — turning on a personal setting makes
      // it an override, and the workspace default is what the other tab shows
      // people who have none — so the whole thing is re-read once it lands.
      const res = await getDigestSettings(workspaceId);
      setData(res);
      setDefaults(res.defaults);
      setMine(res.effective);
      setSaveState('saved');
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('failed');
      await showAlert({ title: '저장하지 못했습니다', message: e.message, type: 'error' });
      load();
    }
  };

  const useDefault = async () => {
    setSaveState('saving');
    try {
      await saveMyDigestSettings(workspaceId, {
        enabled: null, send_hour: null, send_minute: null, horizons: null,
      });
      setSaveState('idle');
      load();
    } catch (e) {
      setSaveState('failed');
      await showAlert({ title: '되돌리지 못했습니다', message: e.message, type: 'error' });
    }
  };

  const test = async () => {
    setIsTesting(true);
    try {
      const res = await sendTestDigest(workspaceId);
      await showAlert({
        title: res.sent ? '보냈습니다' : '보내지 않았습니다',
        message: res.sent ? `${res.to} 주소로 미리보기를 보냈습니다.` : (res.reason || '메일을 보내지 못했습니다.'),
        type: res.sent ? 'success' : 'warning',
      });
    } catch (e) {
      await showAlert({ title: '보내지 못했습니다', message: e.message, type: 'error' });
    } finally {
      setIsTesting(false);
    }
  };

  const overridden = Object.keys(data?.mine || {}).length > 0;
  const zoneLabel = (data?.timezone_choices || []).find((t) => t.value === data?.defaults?.timezone)?.label
    || data?.defaults?.timezone || '';
  const clockText = (() => {
    if (!data?.defaults?.timezone) return '—';
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone: data.defaults.timezone, month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date());
    } catch (e) { return '—'; }
  })();

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal-content modal-self-padded dg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dg-head">
          <SettingsIcon size={17} color="var(--accent-primary)" />
          <h2>일정 설정</h2>
          <button type="button" className="btn-icon" onClick={() => onClose(false)} title="닫기"><X size={17} /></button>
        </div>

        {isLoading || !data ? (
          <div className="bd-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>
        ) : (
          <>
            <div className="dg-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
                내 알림
              </button>
              <button type="button" role="tab" aria-selected={tab === 'defaults'} className={tab === 'defaults' ? 'on' : ''} onClick={() => setTab('defaults')}>
                워크스페이스 기본값
              </button>
            </div>

            <div className="dg-body">
              {/* The facts, stated as facts rather than folded into a
                  sentence — a paragraph that wraps mid-phrase is what made
                  this read as unfinished. */}
              <div className="dg-summary">
                <span className="dg-sum-item">
                  <span className="dg-sum-label">기준시</span>
                  <strong>{zoneLabel}</strong>
                </span>
                <span className="dg-sum-item">
                  <span className="dg-sum-label">현재</span>
                  <strong className="dg-sum-clock">{clockText}</strong>
                </span>
                {tab === 'mine' && (
                  <span className={`dg-sum-tag ${overridden ? 'on' : ''}`}>
                    {overridden ? '개인 설정 적용 중' : '기본값을 따르는 중'}
                  </span>
                )}
              </div>

              {!data.email_configured && (
                <div className="dg-warn">
                  <AlertTriangle size={14} />
                  <span>메일 발송이 설정되지 않아 실제로는 보내지지 않습니다.</span>
                </div>
              )}

              <div className="dg-rows">
                {tab === 'defaults' && (
                  <div className="dg-row">
                    <span className="dg-label">기준시</span>
                    <div className="dg-control">
                      <Dropdown
                        value={defaults.timezone}
                        options={(data.timezone_choices || []).map((tz) => ({ value: tz.value, label: tz.label }))}
                        onChange={(v) => apply({ timezone: v })}
                        label="기준시"
                        className="dg-wide"
                      />
                      <small>모든 일정의 기한을 이 시각으로 판단합니다.</small>
                    </div>
                  </div>
                )}

                <div className="dg-row">
                  <span className="dg-label">알림 메일</span>
                  <div className="dg-control">
                    <Toggle
                      on={!!editing.enabled}
                      onChange={(v) => apply({ enabled: v })}
                      onLabel="매일 받는 중"
                      offLabel="받지 않는 중"
                      title="매일 알림 메일을 받을지 여부"
                    />
                  </div>
                </div>

                <div className="dg-row">
                  <span className="dg-label">받는 시각</span>
                  <div className="dg-control">
                    <span className="dg-time">
                      <Dropdown
                        value={editing.send_hour} options={HOURS} label="시"
                        onChange={(v) => apply({ send_hour: v })}
                      />
                      <Dropdown
                        value={editing.send_minute} options={MINUTES} label="분"
                        onChange={(v) => apply({ send_minute: v })}
                      />
                    </span>
                  </div>
                </div>

                <div className="dg-row">
                  <span className="dg-label">담을 기간</span>
                  <div className="dg-control">
                    <div className="dg-chips">
                      {(data.horizon_choices || []).map((h) => {
                        const on = (editing.horizons || []).includes(h.value);
                        return (
                          <button
                            key={h.value}
                            type="button"
                            className={`dg-chip ${on ? 'on' : ''}`}
                            disabled={readOnly}
                            onClick={() => toggleHorizon(h.value)}
                          >
                            {on && <Check size={11} />}
                            <span>{h.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <small>가장 가까운 기간 한 곳에만 담깁니다.</small>
                    <small>기한이 지난 할 일은 언제나 ‘오늘 중’에 들어갑니다.</small>
                  </div>
                </div>
              </div>

              {tab === 'defaults' && (
                <p className="dg-foot-note">따로 설정하지 않은 사람에게 적용되는 값입니다.</p>
              )}
            </div>

            <div className="dg-actions">
              {tab === 'mine' && (
                <>
                  <button type="button" className="btn-secondary" onClick={test} disabled={isTesting}>
                    {isTesting ? <Loader2 size={13} className="spin" /> : <Mail size={13} />}
                    <span>나에게 미리보기 보내기</span>
                  </button>
                  {overridden && (
                    <button type="button" className="btn-secondary" onClick={useDefault}>
                      기본값으로
                    </button>
                  )}
                </>
              )}
              {readOnly && <span className="dg-readonly">기본값은 워크스페이스를 관리하는 사람만 바꿀 수 있습니다.</span>}
              <span className="dg-spacer" />
              {saveState !== 'idle' && !readOnly && (
                <span className="dg-savestate">
                  {saveState === 'saving' ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
                  <span>{saveState === 'saving' ? '저장 중' : '저장됨'}</span>
                </span>
              )}
              <button type="button" className="btn-secondary" onClick={() => onClose(true)}>닫기</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
