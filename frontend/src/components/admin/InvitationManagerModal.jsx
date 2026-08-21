import React, { useState, useEffect } from 'react';
import { 
  Mail, 
  UserPlus, 
  Copy, 
  Check, 
  Trash2, 
  X, 
  Clock, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw,
  Send,
  Link as LinkIcon,
  Shield,
  Briefcase
} from 'lucide-react';
import { listInvitations, createInvitation, cancelInvitation } from '../../api';
import { useDialog } from '../../context/DialogContext';
import Select from '../common/Select';

export default function InvitationManagerModal({
  isOpen,
  onClose,
  workspaces = [],
  activeWorkspaceId,
  currentUser
}) {
  const { showAlert, showConfirm } = useDialog();
  const [invitations, setInvitations] = useState([]);
  const [email, setEmail] = useState('');
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId || '');
  const [role, setRole] = useState('member');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [copiedToken, setCopiedToken] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    if (isOpen) {
      setWorkspaceId(activeWorkspaceId || '');
      loadInvitations();
    }
  }, [isOpen, activeWorkspaceId]);

  // Workspaces user can invite to (Owner or Admin or Superadmin)
  const manageableWorkspaces = workspaces.filter(w => 
    currentUser?.is_admin || 
    w.owner_id === currentUser?.id || 
    w.role === 'owner' || 
    w.role === 'admin'
  );

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId);
  const isOwnerOfSelectedWs = currentUser?.is_admin || (selectedWorkspace && (selectedWorkspace.owner_id === currentUser?.id || selectedWorkspace.role === 'owner'));

  // Ensure role is member if not owner
  useEffect(() => {
    if (!isOwnerOfSelectedWs && role === 'admin') {
      setRole('member');
    }
  }, [workspaceId, isOwnerOfSelectedWs]);

  const loadInvitations = async () => {
    setIsLoading(true);
    try {
      const data = await listInvitations(currentUser?.is_admin ? null : activeWorkspaceId);
      setInvitations(data);
    } catch (err) {
      console.error('Failed to load invitations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendInvite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSending(true);
    setMessage({ type: '', text: '' });

    try {
      const newInv = await createInvitation({
        email: email.trim(),
        workspace_id: workspaceId || null,
        role
      });
      setEmail('');
      setMessage({ 
        type: 'success', 
        text: `'${email}' 님에게 초대장을 성공적으로 발송했습니다. (7일간 유효)` 
      });
      await loadInvitations();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || '초대장 발송 실패' });
    } finally {
      setIsSending(false);
    }
  };

  const handleCancelInvite = async (invId) => {
    const confirmed = await showConfirm({
      title: '초대 취소',
      message: '정말 이 초대를 취소하시겠습니까?\n취소된 초대 링크는 더 이상 유효하지 않습니다.',
      type: 'danger',
      confirmText: '초대 취소',
      cancelText: '닫기'
    });
    if (!confirmed) return;

    try {
      await cancelInvitation(invId);
      await loadInvitations();
    } catch (err) {
      await showAlert({
        title: '초대 취소 실패',
        message: '초대를 취소하지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleCopyLink = (token) => {
    const origin = window.location.origin;
    const link = `${origin}?invite_token=${token}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1050 }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          maxWidth: 720, 
          padding: '2rem',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 24px 56px rgba(0, 0, 0, 0.5)',
          background: 'var(--bg-secondary)'
        }}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          justifyContent: 'space-between', 
          marginBottom: '1.5rem', 
          borderBottom: '1px solid var(--border-subtle)', 
          paddingBottom: '1.25rem' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: 'rgba(59, 130, 246, 0.12)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-primary)',
              flexShrink: 0
            }}>
              <Mail size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3, wordBreak: 'keep-all' }}>
                {currentUser?.is_admin ? '초대 및 멤버 관리' : '워크스페이스 멤버 초대'}
              </h2>
              <p style={{ 
                fontSize: '0.8rem', 
                color: 'var(--text-muted)', 
                marginTop: '4px', 
                lineHeight: 1.45,
                wordBreak: 'keep-all',
                overflowWrap: 'break-word'
              }}>
                초대 링크는 발송일로부터 7일간 유효합니다.
              </p>
            </div>
          </div>
          <button 
            className="btn-icon" 
            onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* Message Banner */}
        {message.text && (
          <div style={{
            padding: '0.65rem 0.9rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.25rem',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: message.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            color: message.type === 'error' ? 'var(--accent-rose)' : 'var(--accent-emerald)',
            border: `1px solid ${message.type === 'error' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`
          }}>
            {message.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Send Invitation Form Card */}
        {manageableWorkspaces.length === 0 && !currentUser?.is_admin ? (
          <div style={{
            background: 'var(--bg-tertiary)',
            padding: '1.5rem',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            marginBottom: '1.75rem',
            textAlign: 'center',
            color: 'var(--text-muted)'
          }}>
            <AlertCircle size={24} color="var(--accent-amber)" style={{ margin: '0 auto 8px', display: 'block' }} />
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>초대 권한 안내</div>
            <div style={{ fontSize: '0.82rem', lineHeight: 1.4 }}>
              멤버 초대는 <strong>워크스페이스 소유자</strong> 및 <strong>지정된 관리자</strong>만 발송할 수 있습니다.
            </div>
          </div>
        ) : (
          <form 
            onSubmit={handleSendInvite} 
            style={{ 
              background: 'var(--bg-tertiary)', 
              padding: '1.25rem 1.4rem', 
              borderRadius: 'var(--radius-lg)', 
              border: '1px solid var(--border-subtle)',
              marginBottom: '1.75rem' 
            }}
          >
            <div style={{ 
              fontSize: '0.92rem', 
              fontWeight: 700, 
              color: 'var(--text-primary)', 
              marginBottom: '1rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6 
            }}>
              <UserPlus size={16} color="var(--accent-primary)" />
              <span>새 멤버 초대장 발송</span>
            </div>

            <div className="invitation-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.1fr 100px', gap: '0.75rem', marginBottom: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  초대할 이메일 주소
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0 0.85rem',
                    fontSize: '0.875rem',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  대상 워크스페이스
                </label>
                <Select
                  value={workspaceId}
                  onChange={setWorkspaceId}
                  options={[
                    ...(currentUser?.is_admin ? [{ value: '', label: '전체 서비스 (기본)' }] : []),
                    ...manageableWorkspaces.map(w => {
                      const isOwner = currentUser?.is_admin || w.owner_id === currentUser?.id || w.role === 'owner';
                      return { value: w.id, label: `${w.name} (${isOwner ? '소유자' : '관리자'})` };
                    }),
                  ]}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                  역할 권한
                </label>
                <Select
                  value={role}
                  onChange={setRole}
                  options={[
                    { value: 'member', label: '멤버' },
                    isOwnerOfSelectedWs
                      ? { value: 'admin', label: '관리자' }
                      : { value: 'admin', label: '관리자 (소유자 전용)', disabled: true },
                  ]}
                />
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', wordBreak: 'keep-all' }}>
                {!isOwnerOfSelectedWs && (
                  <span>* 관리자(Admin) 권한 초대는 워크스페이스 소유자만 가능합니다.</span>
                )}
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={isSending || !email.trim()}
                style={{ 
                  height: 38, 
                  padding: '0 1.25rem', 
                  fontSize: '0.85rem', 
                  fontWeight: 700, 
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginLeft: 'auto'
                }}
              >
                {isSending ? (
                  <>
                    <RefreshCw size={14} className="spin-anim" />
                    <span>발송 중...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>초대장 발송</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Sent Invitations List Section */}
        <div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            marginBottom: '0.85rem' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                발송된 초대 내역
              </span>
              <span className="menu-badge" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
                {invitations.length}
              </span>
            </div>
            <button 
              className="btn-icon" 
              onClick={loadInvitations} 
              title="새로고침"
              style={{ width: 30, height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <RefreshCw size={14} className={isLoading ? 'spin-anim' : ''} />
            </button>
          </div>

          <div style={{ maxHeight: 280, overflowY: 'auto', paddingRight: '2px' }}>
            {invitations.length === 0 ? (
              <div style={{ 
                padding: '2.5rem 1rem', 
                textAlign: 'center', 
                color: 'var(--text-muted)', 
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-subtle)',
                fontSize: '0.85rem' 
              }}>
                <Mail size={32} color="var(--text-muted)" style={{ margin: '0 auto 0.6rem', display: 'block', opacity: 0.6 }} />
                발송된 초대 내역이 없습니다.
              </div>
            ) : (
              invitations.map(inv => {
                const isPending = inv.status === 'pending';
                const isExpired = inv.is_expired || inv.status === 'expired';
                const isAccepted = inv.status === 'accepted';
                const isCancelled = inv.status === 'cancelled';

                return (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.85rem 1rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      marginBottom: '0.6rem',
                      fontSize: '0.85rem',
                      transition: 'var(--transition-fast)'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingRight: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {inv.email}
                        </span>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: 4,
                          fontWeight: 700,
                          backgroundColor: isAccepted ? 'rgba(16, 185, 129, 0.15)' : isPending ? 'rgba(59, 130, 246, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                          color: isAccepted ? 'var(--accent-emerald)' : isPending ? 'var(--accent-primary)' : 'var(--accent-rose)',
                          border: `1px solid ${isAccepted ? 'rgba(16, 185, 129, 0.3)' : isPending ? 'rgba(59, 130, 246, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`
                        }}>
                          {isAccepted ? '수락 완료' : isPending ? '대기 중 (7일 유효)' : isExpired ? '만료됨' : '취소됨'}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span>워크스페이스: <strong style={{ color: 'var(--text-secondary)' }}>{inv.workspace_name || '전체 서비스'}</strong></span>
                        <span>·</span>
                        <span>역할: <strong style={{ color: 'var(--text-secondary)' }}>{inv.role === 'admin' ? '관리자' : '멤버'}</strong></span>
                        <span>·</span>
                        <span>만료: {new Date(inv.expires_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                      {isPending && (
                        <button
                          className="btn-secondary"
                          onClick={() => handleCopyLink(inv.token)}
                          style={{ 
                            height: 32, 
                            fontSize: '0.78rem', 
                            padding: '0 0.75rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                          title="초대 링크 복사"
                        >
                          {copiedToken === inv.token ? <Check size={13} color="var(--accent-emerald)" /> : <Copy size={13} />}
                          <span>{copiedToken === inv.token ? '복사됨!' : '링크 복사'}</span>
                        </button>
                      )}

                      {isPending && (
                        <button
                          className="btn-icon"
                          onClick={() => handleCancelInvite(inv.id)}
                          title="초대 취소"
                          style={{ 
                            width: 32, 
                            height: 32, 
                            borderRadius: 6,
                            color: 'var(--accent-rose)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
