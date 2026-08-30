import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Camera, Check, Loader2, AtSign, User as UserIcon, Globe, Trash2,
} from '../../utils/icons';
import {
  updateMyName, updateMyUsername, checkMyUsernameAvailable, checkNameAvailable,
  uploadAvatar, removeAvatar as removeAvatarRequest, listLanguages, updateMyLanguage,
} from '../../api';
import { useDialog } from '../../context/DialogContext';

/**
 * Everything that says who you are, in one place.
 *
 * These three sat squeezed into the account dropdown, two of them behind
 * pencils on a single line — which is why nobody could tell which field the
 * other screens were showing them by. Here each one has room to say what it is
 * for, which is the whole difference between a handle and a name.
 */
export default function ProfileModal({ isOpen, currentUser, onClose, onUserUpdated }) {
  const { showAlert, showConfirm } = useDialog();
  const fileRef = useRef(null);

  const [name, setName] = useState('');
  const [nameState, setNameState] = useState('idle');     // idle | checking | free | taken | saved
  const [nameMessage, setNameMessage] = useState('');
  const [handle, setHandle] = useState('');
  const [handleState, setHandleState] = useState('idle');
  const [handleMessage, setHandleMessage] = useState('');
  const [languages, setLanguages] = useState([]);
  const [isBusy, setIsBusy] = useState('');               // 'name' | 'handle' | 'avatar' | 'language'

  useEffect(() => {
    if (!isOpen) return;
    setName(currentUser?.name || '');
    setHandle(currentUser?.username || '');
    setNameState('idle'); setHandleState('idle');
    setNameMessage(''); setHandleMessage('');
    listLanguages().then((res) => setLanguages(res.languages || [])).catch(() => {});
  }, [isOpen, currentUser?.name, currentUser?.username]);

  // Both are checked as they are typed, because both must be unique and being
  // told at save time is being told too late.
  useEffect(() => {
    const next = name.trim();
    if (!isOpen || !next || next === (currentUser?.name || '')) { setNameState('idle'); return undefined; }
    setNameState('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await checkNameAvailable(next);
        setNameState(res.available ? 'free' : 'taken');
        setNameMessage(res.reason || '');
      } catch (e) { setNameState('idle'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [name, isOpen, currentUser?.name]);

  useEffect(() => {
    const next = handle.trim();
    if (!isOpen || !next || next === (currentUser?.username || '')) { setHandleState('idle'); return undefined; }
    if (next.length < 3) { setHandleState('taken'); setHandleMessage('3자 이상이어야 합니다.'); return undefined; }
    setHandleState('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await checkMyUsernameAvailable(next);
        setHandleState(res.available ? 'free' : 'taken');
        setHandleMessage(res.reason || '');
      } catch (e) { setHandleState('idle'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [handle, isOpen, currentUser?.username]);

  if (!isOpen) return null;

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === (currentUser?.name || '') || nameState === 'taken') return;
    setIsBusy('name');
    try {
      const res = await updateMyName(next);
      onUserUpdated?.({ ...currentUser, name: res.name });
      setNameState('saved');
    } catch (e) {
      setNameState('taken');
      setNameMessage(e.message);
    } finally { setIsBusy(''); }
  };

  const saveHandle = async () => {
    const next = handle.trim();
    if (!next || next === (currentUser?.username || '') || handleState !== 'free') return;
    const ok = await showConfirm({
      title: '아이디를 바꿉니다',
      message: `앞으로 올리는 파일과 할 일에 '@${next}'로 표시되고, 공용 워크스페이스의 내 폴더 이름도 함께 바뀝니다.`,
      confirmText: '바꾸기',
      cancelText: '취소',
    });
    if (!ok) return;
    setIsBusy('handle');
    try {
      const res = await updateMyUsername(next);
      onUserUpdated?.({ ...currentUser, username: res.username });
      setHandleState('saved');
    } catch (e) {
      setHandleState('taken');
      setHandleMessage(e.message);
    } finally { setIsBusy(''); }
  };

  const changeLanguage = async (value) => {
    setIsBusy('language');
    try {
      const res = await updateMyLanguage(value);
      onUserUpdated?.(res.user);
    } catch (e) {
      await showAlert({ title: '사용 언어를 바꾸지 못했습니다', message: e.message, type: 'error' });
    } finally { setIsBusy(''); }
  };

  const pickAvatar = async (picked) => {
    if (!picked) return;
    setIsBusy('avatar');
    try {
      const res = await uploadAvatar(picked);
      onUserUpdated?.({ ...currentUser, picture: res.picture });
    } catch (e) {
      await showAlert({ title: '사진을 바꾸지 못했습니다', message: e.message, type: 'error' });
    } finally { setIsBusy(''); }
  };

  const removeAvatar = async () => {
    setIsBusy('avatar');
    try {
      const res = await removeAvatarRequest();
      onUserUpdated?.({ ...currentUser, picture: res.picture || null });
    } catch (e) {
      await showAlert({ title: '사진을 지우지 못했습니다', message: e.message, type: 'error' });
    } finally { setIsBusy(''); }
  };

  const hint = (state, message, okText) => {
    if (state === 'taken') return <span className="pf-hint bad">{message || '사용할 수 없습니다.'}</span>;
    if (state === 'free') return <span className="pf-hint good">{okText}</span>;
    if (state === 'saved') return <span className="pf-hint good">저장했습니다.</span>;
    return null;
  };

  return createPortal(
    <div className="modal-overlay" style={{ zIndex: 1500 }} onClick={onClose}>
      <div className="modal-content modal-self-padded pf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pf-head">
          <h2>내 프로필</h2>
          <button type="button" className="btn-icon" onClick={onClose} title="닫기"><X size={17} /></button>
        </div>

        <div className="pf-body">
          <div className="pf-avatar-row">
            <span className="pf-avatar">
              {currentUser?.picture
                ? <img src={currentUser.picture} alt={currentUser.name || ''} />
                : <span className="pf-avatar-fallback">{(currentUser?.name || currentUser?.email || 'U')[0].toUpperCase()}</span>}
              {isBusy === 'avatar' && <span className="pf-avatar-busy"><Loader2 size={18} className="spin" /></span>}
            </span>
            <div className="pf-avatar-actions">
              <span className="pf-label">프로필 사진</span>
              <span className="pf-desc">댓글과 담당자 표시에 쓰입니다.</span>
              <span className="pf-avatar-buttons">
                <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={isBusy === 'avatar'}>
                  <Camera size={13} /><span>사진 바꾸기</span>
                </button>
                {currentUser?.picture && (
                  <button type="button" className="btn-secondary" onClick={removeAvatar} disabled={isBusy === 'avatar'}>
                    <Trash2 size={13} /><span>기본 사진으로</span>
                  </button>
                )}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pickAvatar(f); }}
              />
            </div>
          </div>

          <div className="pf-field">
            <span className="pf-label"><AtSign size={13} />아이디</span>
            <span className="pf-desc">
              올린 파일과 할 일에 표시되고, 공용 워크스페이스에서 내 폴더 이름이 됩니다.
              영문 소문자·숫자·밑줄만 쓸 수 있고, 누구와도 겹칠 수 없습니다.
              바꾼 기록은 남아 누구나 볼 수 있으며, 30일에 한 번 바꿀 수 있습니다.
              내가 쓰던 아이디는 180일 동안 다른 사람이 가져갈 수 없습니다.
            </span>
            <span className={`pf-input state-${handleState}`}>
              <input
                value={handle}
                maxLength={20}
                onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                onKeyDown={(e) => { if (e.key === 'Enter') saveHandle(); }}
                aria-label="아이디"
              />
              {handleState === 'checking' && <Loader2 size={14} className="spin" />}
              <button
                type="button"
                className="btn-secondary pf-save"
                disabled={handleState !== 'free' || isBusy === 'handle'}
                onClick={saveHandle}
              >
                {isBusy === 'handle' ? <Loader2 size={13} className="spin" /> : <Check size={13} />}<span>저장</span>
              </button>
            </span>
            {hint(handleState, handleMessage, '사용할 수 있는 아이디입니다.')}
          </div>

          <div className="pf-field">
            <span className="pf-label"><UserIcon size={13} />이름</span>
            <span className="pf-desc">
              사람들이 나를 알아보는 이름입니다. 아이디 옆에 함께 표시됩니다.
            </span>
            <span className={`pf-input state-${nameState}`}>
              <input
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
                aria-label="이름"
              />
              {nameState === 'checking' && <Loader2 size={14} className="spin" />}
              <button
                type="button"
                className="btn-secondary pf-save"
                disabled={nameState !== 'free' || isBusy === 'name'}
                onClick={saveName}
              >
                {isBusy === 'name' ? <Loader2 size={13} className="spin" /> : <Check size={13} />}<span>저장</span>
              </button>
            </span>
            {hint(nameState, nameMessage, '사용할 수 있는 이름입니다.')}
          </div>

          <div className="pf-field">
            <span className="pf-label"><Globe size={13} />사용 언어</span>
            <span className="pf-desc">가입할 때 브라우저 설정에서 정해졌습니다.</span>
            <select
              className="pf-select"
              value={currentUser?.language || 'ko'}
              disabled={isBusy === 'language'}
              onChange={(e) => changeLanguage(e.target.value)}
              aria-label="사용 언어"
            >
              {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          <div className="pf-field">
            <span className="pf-label">메일 주소</span>
            <span className="pf-static">{currentUser?.email}</span>
          </div>
        </div>

        <div className="pf-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
