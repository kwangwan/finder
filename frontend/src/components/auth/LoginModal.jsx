import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  Shield, 
  AlertCircle, 
  KeyRound, 
  LogIn, 
  UserPlus, 
  Mail, 
  Lock, 
  User as UserIcon,
  CheckCircle2,
  AtSign
} from '../../utils/icons';
import { loginWithGoogle, loginWithPassword, registerWithPassword, getAuthConfig, verifyInvitationToken, checkUsernameAvailable } from '../../api';

// Set via VITE_ENABLE_PASSWORD_AUTH in .env if password test login is needed
const SHOW_TEST_AUTH = import.meta.env.VITE_ENABLE_PASSWORD_AUTH === 'true';

export default function LoginModal({ isOpen, onLoginSuccess, initialInviteToken = null }) {
  const [activeTab, setActiveTab] = useState('google'); // 'google' | 'password'
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [usernameState, setUsernameState] = useState('idle'); // idle | checking | free | taken
  const [usernameMsg, setUsernameMsg] = useState('');

  useEffect(() => {
    if (authMode !== 'register' || username.length < 3) { setUsernameState('idle'); return; }
    const t = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailable(username);
        setUsernameState(res.available ? 'free' : 'taken');
        setUsernameMsg(res.reason || '');
      } catch (e) {
        setUsernameState('idle');
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username, authMode]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [inviteInfo, setInviteInfo] = useState(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState(import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  const googleBtnRef = useRef(null);

  // 1. Check invite token from URL if not passed in props
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('invite_token');
    if (tokenFromUrl) {
      setInviteToken(tokenFromUrl);
      verifyInvitationToken(tokenFromUrl)
        .then(inv => {
          setInviteInfo(inv);
          setEmail(inv.email);
          if (SHOW_TEST_AUTH) {
            setActiveTab('password');
            setAuthMode('register');
          }
        })
        .catch(err => {
          setError(err.message);
        });
    }
  }, []);

  // 2. Fetch Google Client ID from backend if not set
  useEffect(() => {
    if (!clientId) {
      getAuthConfig().then(cfg => {
        if (cfg.google_client_id) {
          setClientId(cfg.google_client_id);
        }
      }).catch(console.error);
    }
  }, [clientId]);

  // 3. Initialize Google Sign-In button
  useEffect(() => {
    if (!isOpen || !clientId || activeTab !== 'google') return;

    function initGoogleBtn() {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        googleBtnRef.current.innerHTML = '';
        const btnWidth = Math.min(320, Math.max(220, window.innerWidth - 80));
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'filled_blue',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: btnWidth,
          logo_alignment: 'left',
        });
      } else {
        setTimeout(initGoogleBtn, 150);
      }
    }

    initGoogleBtn();
  }, [isOpen, clientId, activeTab]);

  const handleGoogleResponse = async (response) => {
    if (!response.credential) {
      setError('구글 인증 자격 증명을 수신하지 못했습니다.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const data = await loginWithGoogle(response.credential, inviteToken);
      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || '구글 로그인 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setIsLoading(true);
    setError('');
    try {
      if (authMode === 'register') {
        const data = await registerWithPassword(email.trim(), password.trim(), name.trim(), inviteToken, username.trim());
        onLoginSuccess(data.user);
      } else {
        const data = await loginWithPassword(email.trim(), password.trim());
        onLoginSuccess(data.user);
      }
    } catch (err) {
      setError(err.message || '인증 실패');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }}>
      <div className="modal-content" style={{ maxWidth: 460, padding: '2.25rem 1.75rem', textAlign: 'center' }}>
        {/* Brand Icon */}
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--accent-gradient)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1rem',
          color: 'var(--on-accent)',
          boxShadow: '0 8px 24px rgba(59, 130, 246, 0.4)'
        }}>
          <Sparkles size={28} />
        </div>

        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          Project Run : Finder
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4, marginBottom: '1.5rem' }}>
          {inviteInfo 
            ? `${inviteInfo.inviter_name || '관리자'}님의 초대를 수락하고 시작하세요.` 
            : 'AI 지식 관리 플랫폼에 로그인해 주세요.'}
        </p>

        {/* Invite Banner */}
        {inviteInfo && (
          <div style={{
            padding: '0.65rem 0.85rem',
            background: 'rgba(59, 130, 246, 0.15)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--accent-primary)',
            fontSize: '0.8rem',
            marginBottom: '1.25rem',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <div>
              <strong>{inviteInfo.workspace_name ? `'${inviteInfo.workspace_name}' 워크스페이스` : '전체 서비스'}</strong> 초대장 확인됨 (7일 유효)
            </div>
          </div>
        )}

        {/* Tab Switcher (Google vs Test Account) */}
        {SHOW_TEST_AUTH && (
          <div style={{
            display: 'flex',
            background: 'var(--bg-tertiary)',
            padding: 4,
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
            border: '1px solid var(--border-subtle)'
          }}>
            <button
              type="button"
              onClick={() => { setActiveTab('google'); setError(''); }}
              style={{
                flex: 1,
                padding: '0.45rem',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: activeTab === 'google' ? 'var(--bg-secondary)' : 'transparent',
                color: activeTab === 'google' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: activeTab === 'google' ? 'var(--shadow-sm)' : 'none',
                transition: 'var(--transition-fast)'
              }}
            >
              구글 소셜 로그인
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('password'); setError(''); }}
              style={{
                flex: 1,
                padding: '0.45rem',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: activeTab === 'password' ? 'var(--bg-secondary)' : 'transparent',
                color: activeTab === 'password' ? 'var(--accent-primary)' : 'var(--text-muted)',
                boxShadow: activeTab === 'password' ? 'var(--shadow-sm)' : 'none',
                transition: 'var(--transition-fast)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4
              }}
            >
              <KeyRound size={13} />
              <span>테스트 계정 (ID/PW)</span>
            </button>
          </div>
        )}

        {error && (
          <div style={{
            padding: '0.65rem 0.85rem',
            background: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--accent-rose)',
            fontSize: '0.82rem',
            marginBottom: '1.25rem',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Tab 1: Google OAuth */}
        {activeTab === 'google' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'center', minHeight: 44, margin: '1rem 0' }}>
              {isLoading ? (
                <div style={{ padding: '0.75rem', color: 'var(--accent-primary)', fontSize: '0.875rem', fontWeight: 600 }}>
                  로그인 처리 중...
                </div>
              ) : (
                <div ref={googleBtnRef} style={{ display: 'inline-block' }} />
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Test Password Auth (Login & Register) */}
        {SHOW_TEST_AUTH && activeTab === 'password' && (
          <form onSubmit={handlePasswordSubmit} style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                {authMode === 'login' ? '테스트 계정 로그인' : '새 테스트 계정 가입'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(prev => prev === 'login' ? 'register' : 'login');
                  setError('');
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {authMode === 'login' ? '회원가입 하기 →' : '기존 계정 로그인 →'}
              </button>
            </div>

            {authMode === 'register' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  아이디
                </label>
                <div style={{ position: 'relative' }}>
                  <AtSign size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text"
                    required
                    placeholder="hong_gildong"
                    value={username}
                    onChange={e => {
                      // Normalised as it is typed, so what you see is exactly
                      // what will be stored — there is only one way to write
                      // any handle.
                      const next = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
                      setUsername(next);
                      setUsernameState(next.length >= 3 ? 'checking' : 'idle');
                    }}
                    maxLength={20}
                    style={{
                      width: '100%',
                      background: 'var(--bg-tertiary)',
                      border: `1px solid ${usernameState === 'taken' ? 'var(--accent-rose)' : usernameState === 'free' ? 'var(--accent-emerald)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '0.55rem 0.75rem 0.55rem 2rem',
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      outline: 'none'
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.7rem', marginTop: 4, color: usernameState === 'taken' ? 'var(--accent-rose)' : usernameState === 'free' ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                  {usernameState === 'taken' ? (usernameMsg || '사용할 수 없는 아이디입니다.')
                    : usernameState === 'free' ? '사용할 수 있는 아이디입니다.'
                    : '영문 소문자·숫자·밑줄(_) 3~20자. 다른 이용자에게 표시되는 고유 아이디입니다.'}
                </div>
              </div>
            )}

            {authMode === 'register' && (
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  이름 (닉네임)
                </label>
                <div style={{ position: 'relative' }}>
                  <UserIcon size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text"
                    required
                    placeholder="홍길동"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '0.55rem 0.75rem 0.55rem 2rem',
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                이메일 아이디
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="email"
                  required
                  placeholder="test@proj.run"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.55rem 0.75rem 0.55rem 2rem',
                    fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                비밀번호
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="password"
                  required
                  placeholder="비밀번호 입력"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.55rem 0.75rem 0.55rem 2rem',
                    fontSize: '0.85rem',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={
                isLoading || !email.trim() || !password.trim()
                // 가입할 때는 쓸 수 있는 아이디까지 확인된 뒤에 눌리게 한다
                || (authMode === 'register' && usernameState !== 'free')
              }
              style={{ width: '100%', padding: '0.65rem', fontSize: '0.875rem' }}
            >
              {authMode === 'register' ? <UserPlus size={16} /> : <LogIn size={16} />}
              <span>{isLoading ? '처리 중...' : (authMode === 'register' ? '테스트 계정 가입' : '테스트 계정 로그인')}</span>
            </button>
          </form>
        )}

        {/* Security Info */}
        <div style={{
          marginTop: '1.25rem',
          padding: '0.65rem 0.85rem',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          lineHeight: 1.4,
          border: '1px solid var(--border-subtle)',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.45rem',
          wordBreak: 'keep-all',
        }}>
          <Shield size={14} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          <span>초대 링크 또는 계정 가입을 통해 즉시 워크스페이스에 참여할 수 있습니다.</span>
        </div>
      </div>
    </div>
  );
}
