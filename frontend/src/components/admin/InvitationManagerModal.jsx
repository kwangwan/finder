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
        text: currentUser?.is_admin 
          ? `'${email}' 님에게 7일 유효 초대장이 발송되었습니다. (가입 시 즉시 자동 승인)` 
          : `'${email}' 님에게 7일 유효 초대장이 발송되었습니다. (가입 후 최고 관리자 승인 필요)` 
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                {currentUser?.is_admin ? '초대 관리 & 멤버 승인' : '워크스페이스 멤버 초대'}
              </h2>
              <p style={{ 
                fontSize: '0.82rem', 
                color: 'var(--text-muted)', 
                marginTop: '4px', 
                lineHeight: 1.45,
                wordBreak: 'keep-all',
                overflowWrap: 'break-word'
              }}>
                {currentUser?.is_admin 
                  ? '초대 링크는 7일간 유효하며, 가입 즉시 자동 승인됩니다.'
                  : '초대 링크는 7일간 유효하며, 가입 후 관리자 승인이 필요합니다.'}
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
              <select
                value={workspaceId}
                onChange={e => setWorkspaceId(e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0 0.75rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              >
                {currentUser?.is_admin && <option value="">전체 서비스 (기본)</option>}
                {workspaces.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                역할 권한
              </label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0 0.65rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              >
                <option value="member">멤버</option>
                <option value="admin">관리자</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
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
                gap: 6
              }}
            >
              <Send size={14} />
              <span>{isSending ? '초대장 발송 중...' : '초대장 발송하기'}</span>
            </button>
          </div>
        </form>

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
                        {inv.is_admin_invite ? (
                          <span style={{ 
                            fontSize: '0.7rem', 
                            color: 'var(--accent-amber)', 
                            fontWeight: 700,
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            padding: '0.1rem 0.45rem',
                            borderRadius: 4,
                            border: '1px solid rgba(245, 158, 11, 0.25)'
                          }}>
                            자동 승인 대상
                          </span>
                        ) : (
                          <span style={{ 
                            fontSize: '0.7rem', 
                            color: 'var(--text-muted)', 
                            fontWeight: 600,
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            padding: '0.1rem 0.45rem',
                            borderRadius: 4,
                            border: '1px solid var(--border-subtle)'
                          }}>
                            관리자 승인 필요
                          </span>
                        )}
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
