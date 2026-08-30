import React, { useEffect, useState } from 'react';
import { AtSign, Check, Loader2, LogOut } from '../../utils/icons';
import { checkMyUsernameAvailable, updateMyUsername } from '../../api';

/**
 * An account with no handle, asked for one before anything else.
 *
 * The handle is the identity everything shows — who uploaded a file, who a 할
 * 일 belongs to, and the name of the personal folder in the shared workspace.
 * An account without one would appear in all of those places as an email
 * address or as nothing at all, so it is asked for here rather than left to be
 * discovered later by whoever reads those screens.
 */
export default function ChooseHandleScreen({ user, onDone, onLogout }) {
  const [handle, setHandle] = useState('');
  const [state, setState] = useState('idle');   // idle | checking | free | taken
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (handle.length < 3) { setState('idle'); setMessage(''); return undefined; }
    setState('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await checkMyUsernameAvailable(handle);
        setState(res.available ? 'free' : 'taken');
        setMessage(res.reason || '');
      } catch (e) {
        setState('idle');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [handle]);

  const save = async () => {
    if (state !== 'free' || isSaving) return;
    setIsSaving(true);
    try {
      const res = await updateMyUsername(handle);
      onDone({ ...user, username: res.username });
    } catch (e) {
      setState('taken');
      setMessage(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="ch-screen">
      <div className="ch-card">
        <h1>아이디를 정해 주세요</h1>
        <p>
          아이디는 올린 파일과 할 일에 표시되고, 공용 워크스페이스에서 회원님의 폴더 이름이 됩니다.
          영문 소문자와 숫자, 밑줄만 쓸 수 있습니다.
        </p>

        <div className={`ch-field state-${state}`}>
          <AtSign size={16} />
          <input
            type="text"
            autoFocus
            placeholder="hong_gildong"
            value={handle}
            maxLength={20}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          />
          {state === 'checking' && <Loader2 size={15} className="spin" />}
          {state === 'free' && <Check size={15} />}
        </div>

        <div className={`ch-hint state-${state}`}>
          {state === 'taken' ? (message || '이미 사용 중인 아이디입니다.')
            : state === 'free' ? '사용할 수 있는 아이디입니다.'
              : '3자 이상 20자 이하로 입력해 주세요.'}
        </div>

        <button type="button" className="btn-primary ch-save" disabled={state !== 'free' || isSaving} onClick={save}>
          {isSaving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
          <span>이 아이디로 시작하기</span>
        </button>

        <button type="button" className="ch-logout" onClick={onLogout}>
          <LogOut size={13} /><span>로그아웃</span>
        </button>
      </div>
    </div>
  );
}
