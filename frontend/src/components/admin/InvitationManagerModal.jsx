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
  Link as LinkIcon
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
      setMessage({ type: 'success', text: `'${email}' 님에게 7일 유효 초대장이 발송되었습니다.` });
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
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, padding: '1.75rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Mail size={22} color="var(--accent-primary)" />
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                초대 관리 & 멤버 승인
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                초대된 사용자는 7일 동안 유효하며, 최고 관리자 초대는 가입 즉시 자동 승인됩니다.
              </p>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Message Banner */}
        {message.text && (
          <div style={{
            padding: '0.6rem 0.8rem',
            background: message.type === 'error' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${message.type === 'error' ? 'rgba(244, 63, 94, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
            borderRadius: 'var(--radius-md)',
            color: message.type === 'error' ? 'var(--accent-rose)' : 'var(--accent-emerald)',
            fontSize: '0.85rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            {message.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
            <span>{message.text}</span>
          </div>
        )}

        {/* Send Invitation Form */}
        <form onSubmit={handleSendInvite} style={{ background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserPlus size={15} color="var(--accent-primary)" />
            <span>새 멤버 초대장 발송</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 90px auto', gap: '0.5rem' }}>
            <input
              type="email"
              required
              placeholder="초대할 사용자 이메일"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.5rem 0.75rem',
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            />

            <select
              value={workspaceId}
              onChange={e => setWorkspaceId(e.target.value)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.5rem 0.6rem',
                fontSize: '0.82rem',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            >
              {currentUser?.is_admin && <option value="">전체 서비스 (자동 승인)</option>}
              {workspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>

            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.5rem 0.5rem',
                fontSize: '0.82rem',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
            >
              <option value="member">멤버</option>
              <option value="admin">관리자</option>
            </select>

            <button
              type="submit"
              className="btn-primary"
              disabled={isSending || !email.trim()}
              style={{ padding: '0.5rem 0.9rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
            >
              <Send size={13} />
              <span>{isSending ? '발송 중...' : '초대 발송'}</span>
            </button>
          </div>
        </form>

        {/* Sent Invitations List */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            발송된 초대 목록 ({invitations.length})
          </div>
          <button className="btn-icon" onClick={loadInvitations} title="새로고침">
            <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
          </button>
        </div>

        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          {invitations.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              발송된 초대가 없습니다.
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
                    padding: '0.65rem 0.85rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 6,
                    fontSize: '0.82rem'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{inv.email}</span>
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 4,
                        fontWeight: 600,
                        backgroundColor: isAccepted ? 'rgba(16, 185, 129, 0.2)' : isPending ? 'rgba(59, 130, 246, 0.2)' : 'rgba(244, 63, 94, 0.2)',
                        color: isAccepted ? 'var(--accent-emerald)' : isPending ? 'var(--accent-primary)' : 'var(--accent-rose)'
                      }}>
                        {isAccepted ? '수락 완료' : isPending ? '대기 중 (7일 유효)' : isExpired ? '만료됨' : '취소됨'}
                      </span>
                      {inv.is_admin_invite && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--accent-amber)', fontWeight: 600 }}>[자동승인 대상]</span>
                      )}
                    </div>

                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      워크스페이스: <strong>{inv.workspace_name || '전체 서비스'}</strong> ({inv.role === 'admin' ? '관리자' : '멤버'}) · 
                      만료일: {new Date(inv.expires_at).toLocaleDateString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {isPending && (
                      <button
                        className="btn-secondary"
                        onClick={() => handleCopyLink(inv.token)}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                        title="초대 링크 복사"
                      >
                        {copiedToken === inv.token ? <Check size={12} color="var(--accent-emerald)" /> : <Copy size={12} />}
                        <span>{copiedToken === inv.token ? '복사됨!' : '링크 복사'}</span>
                      </button>
                    )}

                    {isPending && (
                      <button
                        className="btn-icon"
                        onClick={() => handleCancelInvite(inv.id)}
                        title="초대 취소"
                        style={{ padding: 4 }}
                      >
                        <Trash2 size={14} color="var(--accent-rose)" />
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
  );
}
