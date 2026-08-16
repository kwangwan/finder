import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  Users, 
  UserPlus, 
  Plus, 
  Trash2, 
  X, 
  Crown, 
  ShieldCheck, 
  User, 
  UserX, 
  CheckCircle2, 
  AlertCircle,
  Code,
  Palette,
  Globe,
  BookOpen,
  Layers,
  Settings
} from 'lucide-react';
import { 
  createWorkspace, 
  updateWorkspace, 
  deleteWorkspace, 
  listWorkspaceMembers, 
  inviteWorkspaceMember, 
  updateWorkspaceMemberRole, 
  removeWorkspaceMember 
} from '../../api';
import { useDialog } from '../../context/DialogContext';

const ICONS = [
  { id: 'briefcase', label: '업무', Icon: Briefcase },
  { id: 'code', label: '개발', Icon: Code },
  { id: 'palette', label: '디자인', Icon: Palette },
  { id: 'globe', label: '글로벌', Icon: Globe },
  { id: 'book', label: '연구', Icon: BookOpen },
  { id: 'layers', label: '프로젝트', Icon: Layers },
];

export default function WorkspaceSettingsModal({
  isOpen,
  onClose,
  isCreateMode = false,
  workspace,
  currentUser,
  onWorkspaceCreated,
  onWorkspaceUpdated,
  onWorkspaceDeleted,
}) {
  const { showAlert, showConfirm } = useDialog();
  const [activeTab, setActiveTab] = useState('settings'); // 'settings' | 'members'
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('briefcase');

  // Members state
  const [members, setMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError('');
      setSuccessMsg('');
      if (isCreateMode) {
        setName('');
        setDescription('');
        setIcon('briefcase');
        setActiveTab('settings');
      } else if (workspace) {
        setName(workspace.name || '');
        setDescription(workspace.description || '');
        setIcon(workspace.icon || 'briefcase');
        loadMembers();
      }
    }
  }, [isOpen, isCreateMode, workspace?.id]);

  const loadMembers = async () => {
    if (!workspace?.id) return;
    try {
      const list = await listWorkspaceMembers(workspace.id);
      setMembers(list);
    } catch (err) {
      console.error('Failed to load workspace members:', err);
    }
  };

  if (!isOpen) return null;

  const isOwner = isCreateMode || workspace?.owner_id === currentUser?.id || currentUser?.is_admin;
  const currentMember = members.find(m => m.user_id === currentUser?.id);
  const isAdminOrOwner = isOwner || currentMember?.role === 'admin';

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    setError('');
    try {
      if (isCreateMode) {
        const newWs = await createWorkspace({
          name: name.trim(),
          description: description.trim(),
          icon
        });
        setSuccessMsg(`'${newWs.name}' 워크스페이스가 생성되었습니다.`);
        if (onWorkspaceCreated) onWorkspaceCreated(newWs);
        setTimeout(() => onClose(), 1000);
      } else {
        const updated = await updateWorkspace(workspace.id, {
          name: name.trim(),
          description: description.trim(),
          icon
        });
        setSuccessMsg('워크스페이스 설정이 저장되었습니다.');
        if (onWorkspaceUpdated) onWorkspaceUpdated(updated);
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      setError(err.message || '저장 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInviteMember = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !workspace) return;

    setIsLoading(true);
    setError('');
    try {
      await inviteWorkspaceMember(workspace.id, {
        email: inviteEmail.trim(),
        role: inviteRole
      });
      setInviteEmail('');
      await loadMembers();
      setSuccessMsg(`'${inviteEmail}' 님을 초대했습니다.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError(err.message || '멤버 초대 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await updateWorkspaceMemberRole(workspace.id, userId, newRole);
      await loadMembers();
    } catch (err) {
      await showAlert({
        title: '역할 변경 실패',
        message: '멤버의 권한 역할을 변경하지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleRemoveMember = async (userId, userEmail) => {
    const isSelf = userId === currentUser?.id;
    const confirmTitle = isSelf ? '워크스페이스 탈퇴' : '멤버 제외';
    const confirmMsg = isSelf 
      ? `'${workspace.name}' 워크스페이스에서 정말 탈퇴하시겠습니까?` 
      : `'${userEmail}' 멤버를 워크스페이스에서 제외하시겠습니까?`;

    const confirmed = await showConfirm({
      title: confirmTitle,
      message: confirmMsg,
      type: 'danger',
      confirmText: isSelf ? '탈퇴' : '제외',
      cancelText: '취소'
    });
    if (!confirmed) return;

    try {
      await removeWorkspaceMember(workspace.id, userId);
      if (isSelf) {
        if (onWorkspaceDeleted) onWorkspaceDeleted(workspace.id);
        onClose();
      } else {
        await loadMembers();
      }
    } catch (err) {
      await showAlert({
        title: '처리 실패',
        message: '멤버 처리 중 오류가 발생했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  const handleDeleteWorkspace = async () => {
    const confirmed = await showConfirm({
      title: '워크스페이스 영구 삭제',
      message: `'${workspace.name}' 워크스페이스를 정말 삭제하시겠습니까?\n내부의 모든 폴더, 파일, 메모가 영구 삭제되며 복구할 수 없습니다.`,
      type: 'danger',
      confirmText: '영구 삭제',
      cancelText: '취소'
    });
    if (!confirmed) return;

    try {
      await deleteWorkspace(workspace.id);
      if (onWorkspaceDeleted) onWorkspaceDeleted(workspace.id);
      onClose();
    } catch (err) {
      await showAlert({
        title: '삭제 실패',
        message: '워크스페이스를 삭제하지 못했습니다: ' + err.message,
        type: 'error'
      });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1050 }}>
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ 
          maxWidth: 660, 
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
              <Briefcase size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                {isCreateMode ? '새 워크스페이스 만들기' : `${workspace?.name} 워크스페이스 관리`}
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.4 }}>
                {isCreateMode ? '새로운 프로젝트 또는 팀을 위한 독립적인 작업 공간을 생성합니다.' : '워크스페이스 기본 정보 및 소속 멤버 권한을 관리합니다.'}
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

        {error && (
          <div style={{ 
            padding: '0.75rem 1rem', 
            background: 'rgba(244, 63, 94, 0.12)', 
            border: '1px solid rgba(244, 63, 94, 0.25)', 
            borderRadius: 'var(--radius-md)', 
            color: 'var(--accent-rose)', 
            fontSize: '0.85rem', 
            marginBottom: '1.5rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            fontWeight: 500
          }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div style={{ 
            padding: '0.75rem 1rem', 
            background: 'rgba(16, 185, 129, 0.12)', 
            border: '1px solid rgba(16, 185, 129, 0.25)', 
            borderRadius: 'var(--radius-md)', 
            color: 'var(--accent-emerald)', 
            fontSize: '0.85rem', 
            marginBottom: '1.5rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            fontWeight: 500
          }}>
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Tabs for existing workspace */}
        {!isCreateMode && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => setActiveTab('settings')}
              style={{
                padding: '0.5rem 0.85rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'settings' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'settings' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Settings size={15} />
              <span>워크스페이스 설정</span>
            </button>

            <button
              onClick={() => setActiveTab('members')}
              style={{
                padding: '0.5rem 0.85rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'members' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'members' ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Users size={15} />
              <span>멤버 관리 ({members.length})</span>
            </button>
          </div>
        )}

        {/* Tab 1: Settings / Create */}
        {(isCreateMode || activeTab === 'settings') && (
          <form onSubmit={handleSaveSettings}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                워크스페이스 이름 *
              </label>
              <input
                type="text"
                required
                disabled={!isAdminOrOwner}
                placeholder="예: AI 연구 개발팀"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.6rem 0.8rem',
                  fontSize: '0.9rem',
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                워크스페이스 설명
              </label>
              <textarea
                rows={2}
                disabled={!isAdminOrOwner}
                placeholder="워크스페이스의 목적이나 팀을 설명해주세요."
                value={description}
                onChange={e => setDescription(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.6rem 0.8rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                아이콘 테마
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {ICONS.map(item => {
                  const IconComp = item.Icon;
                  const isSelected = icon === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!isAdminOrOwner}
                      onClick={() => setIcon(item.id)}
                      style={{
                        flex: 1,
                        padding: '0.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                        border: '1px solid',
                        borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)'
                      }}
                    >
                      <IconComp size={18} />
                      <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isAdminOrOwner && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={onClose}>
                  취소
                </button>
                <button type="submit" className="btn-primary" disabled={isLoading || !name.trim()}>
                  {isCreateMode ? '워크스페이스 생성' : '변경사항 저장'}
                </button>
              </div>
            )}

            {/* Danger Zone: Delete Workspace */}
            {!isCreateMode && isOwner && (
              <div style={{ marginTop: '2rem', borderTop: '1px solid rgba(244, 63, 94, 0.2)', paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-rose)' }}>
                      워크스페이스 삭제
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      워크스페이스와 포함된 모든 데이터가 삭제됩니다.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDeleteWorkspace}
                    style={{
                      background: 'rgba(244, 63, 94, 0.15)',
                      border: '1px solid rgba(244, 63, 94, 0.3)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--accent-rose)',
                      padding: '0.45rem 0.85rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    워크스페이스 삭제
                  </button>
                </div>
              </div>
            )}
          </form>
        )}

        {/* Tab 2: Members */}
        {!isCreateMode && activeTab === 'members' && (
          <div>
            {/* Invite Form */}
            {isAdminOrOwner && (
              <form onSubmit={handleInviteMember} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', background: 'var(--bg-tertiary)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                <input
                  type="email"
                  required
                  placeholder="초대할 사용자 이메일 (예: teammate@company.com)"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.45rem 0.65rem',
                    fontSize: '0.82rem',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value)}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.45rem',
                    fontSize: '0.82rem',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    width: 90
                  }}
                >
                  <option value="member">멤버</option>
                  {isOwner && <option value="admin">관리자</option>}
                </select>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!inviteEmail.trim() || isLoading}
                  style={{ fontSize: '0.8rem', padding: '0.45rem 0.8rem' }}
                >
                  <UserPlus size={14} />
                  <span>초대</span>
                </button>
              </form>
            )}

            {/* Member List */}
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {members.map(m => {
                const isMemberOwner = m.role === 'owner' || m.user_id === workspace?.owner_id;
                const isSelf = m.user_id === currentUser?.id;

                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.55rem 0.75rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      marginBottom: 5
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <img
                        src={m.user_picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${m.user_email}`}
                        alt={m.user_name}
                        style={{ width: 30, height: 30, borderRadius: '50%' }}
                      />
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {m.user_name || m.user_email?.split('@')[0]}
                          {isMemberOwner && <Crown size={13} color="var(--accent-amber)" title="워크스페이스 소유자" />}
                          {isSelf && <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)' }}>(나)</span>}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {m.user_email}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {/* Role Selector or Badge */}
                      {isOwner && !isMemberOwner ? (
                        <select
                          value={m.role}
                          onChange={e => handleRoleChange(m.user_id, e.target.value)}
                          style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '0.2rem 0.4rem',
                            fontSize: '0.75rem',
                            color: 'var(--text-primary)',
                            outline: 'none'
                          }}
                        >
                          <option value="member">멤버</option>
                          <option value="admin">관리자</option>
                        </select>
                      ) : (
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: isMemberOwner ? 'var(--accent-amber)' : (m.role === 'admin' ? 'var(--accent-primary)' : 'var(--text-muted)'),
                          background: 'var(--bg-card)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: 'var(--radius-sm)'
                        }}>
                          {isMemberOwner ? '소유자' : (m.role === 'admin' ? '관리자' : '멤버')}
                        </span>
                      )}

                      {/* Remove or Leave Button */}
                      {!isMemberOwner && (isAdminOrOwner || isSelf) && (
                        <button
                          className="btn-icon"
                          onClick={() => handleRemoveMember(m.user_id, m.user_email)}
                          title={isSelf ? "워크스페이스 탈퇴" : "멤버 제외"}
                          style={{ padding: 4 }}
                        >
                          <UserX size={15} color="var(--accent-rose)" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
