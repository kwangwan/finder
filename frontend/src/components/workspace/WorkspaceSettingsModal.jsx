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
  Settings,
  AlertTriangle,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  Ban,
} from '../../utils/icons';
import { 
  createWorkspace, 
  updateWorkspace, 
  deleteWorkspace, 
  listWorkspaceMembers, 
  inviteWorkspaceMember, 
  updateWorkspaceMemberRole, 
  removeWorkspaceMember,
  setUserSharedWrite,
  toggleAdminUser
} from '../../api';
import Select from '../common/Select';
import { useDialog } from '../../context/DialogContext';

const ICONS = [
  { id: 'briefcase', label: '업무', Icon: Briefcase },
  { id: 'code', label: '개발', Icon: Code },
  { id: 'palette', label: '디자인', Icon: Palette },
  { id: 'globe', label: '글로벌', Icon: Globe },
  { id: 'book', label: '연구', Icon: BookOpen },
  { id: 'layers', label: '프로젝트', Icon: Layers },
];

// The shared workspace's rows carry the account's own flag; other workspaces
// carry a per-workspace role. Both mean "runs this place".
const member_isAdmin = (m) => !!m.is_superadmin || m.role === 'admin';

// An administrator writes wherever they like — the server does not consult
// can_write_shared for them (AccessService.can_write_workspace). Showing the
// stored flag anyway made an administrator whose flag happened to be off read
// as locked out of the workspace they run.
const member_canWrite = (m) => member_isAdmin(m) || m.can_write_shared !== false;

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
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberPage, setMemberPage] = useState(1);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberBusy, setMemberBusy] = useState(null);   // user id whose switch is in flight
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const MEMBER_PAGE_SIZE = 8;

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
        setMemberQuery('');
        setMemberPage(1);
      }
    }
  }, [isOpen, isCreateMode, workspace?.id]);

  const loadMembers = async (page = memberPage, q = memberQuery) => {
    if (!workspace?.id) return;
    try {
      const res = await listWorkspaceMembers(workspace.id, {
        q, page, pageSize: MEMBER_PAGE_SIZE, paged: true,
      });
      setMembers(res.items || []);
      setMemberTotal(res.total || 0);
    } catch (err) {
      console.error('Failed to load workspace members:', err);
    }
  };

  // Typing in the search box asks the server, so it waits for a pause rather
  // than asking on every keystroke.
  useEffect(() => {
    if (activeTab === 'members' && workspace?.is_shared && !currentUser?.is_superadmin) setActiveTab('settings');
  }, [activeTab, workspace?.is_shared, currentUser?.is_superadmin]);

  useEffect(() => {
    if (!isOpen || isCreateMode || !workspace?.id) return undefined;
    if (workspace.is_shared && !currentUser?.is_superadmin) return undefined;
    const timer = setTimeout(() => { loadMembers(memberPage, memberQuery); }, memberQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [isOpen, isCreateMode, workspace?.id, memberPage, memberQuery]);

  // A new search starts from the first page — page 3 of the old search is not
  // a place in the new one.
  useEffect(() => { setMemberPage(1); }, [memberQuery]);

  if (!isOpen) return null;

  const isSharedWorkspace = !!workspace?.is_shared;
  const isSuperadmin = !!currentUser?.is_superadmin;
  const canSeeMembers = !isSharedWorkspace || isSuperadmin;
  const isOwner = isCreateMode || workspace?.owner_id === currentUser?.id || currentUser?.is_superadmin;
  const currentMember = members.find(m => m.user_id === currentUser?.id);
  const isAdminOrOwner = isOwner || currentMember?.role === 'admin';

  // A workspace is charged to whoever owns it, so someone with no room left
  // would create one where the first upload fails. Said here, before the
  // button is pressed, with the same floor the server enforces.
  const MIN_FREE_BYTES = 50 * 1024 * 1024;
  const remainingBytes = Math.max(
    0,
    (currentUser?.storage_quota_bytes ?? 0)
      - (currentUser?.storage_used_bytes ?? 0)
      - (currentUser?.storage_reserved_bytes ?? 0),
  );
  const outOfRoom = isCreateMode && remainingBytes < MIN_FREE_BYTES;
  const remainingText = remainingBytes >= 1024 * 1024 * 1024
    ? `${(remainingBytes / (1024 ** 3)).toFixed(1)}GB`
    : `${Math.round(remainingBytes / (1024 * 1024))}MB`;

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

  /**
   * The two things that decide what somebody may do in the shared workspace.
   *
   * They used to live only in the administrator dashboard, which is a list of
   * accounts — but "who may write in the shared workspace" is a fact about
   * that workspace, and this is where it is managed.
   */
  const toggleSharedWrite = async (member) => {
    const next = !(member.can_write_shared !== false);
    setMemberBusy(member.user_id);
    try {
      await setUserSharedWrite(member.user_id, next);
      setMembers((list) => list.map((m) => (m.user_id === member.user_id ? { ...m, can_write_shared: next } : m)));
    } catch (err) {
      await showAlert({ title: '쓰기 권한을 바꾸지 못했습니다', message: err.message, type: 'error' });
    } finally { setMemberBusy(null); }
  };

  const toggleAdmin = async (member) => {
    const next = !member.is_superadmin;
    const ok = await showConfirm({
      title: next ? '관리자로 임명합니다' : '관리자에서 해제합니다',
      message: next
        ? `'${member.user_name || member.user_email}'님이 모든 워크스페이스와 사용자 관리 권한을 갖게 됩니다.`
        : `'${member.user_name || member.user_email}'님의 관리자 권한을 회수합니다.`,
      confirmText: next ? '임명' : '해제',
      cancelText: '취소',
    });
    if (!ok) return;
    setMemberBusy(member.user_id);
    try {
      await toggleAdminUser(member.user_id, next);
      setMembers((list) => list.map((m) => (
        m.user_id === member.user_id ? { ...m, is_superadmin: next, role: next ? 'admin' : 'member' } : m
      )));
    } catch (err) {
      await showAlert({ title: '관리자 권한을 바꾸지 못했습니다', message: err.message, type: 'error' });
    } finally { setMemberBusy(null); }
  };

  const handleRemoveMember = async (userId, userEmail) => {
    const isSelf = userId === currentUser?.id;
    const confirmTitle = isSelf ? '워크스페이스 탈퇴' : '멤버 추방';
    const confirmMsg = isSelf 
      ? `'${workspace.name}' 워크스페이스에서 정말 탈퇴하시겠습니까?` 
      : `'${userEmail}' 멤버를 이 워크스페이스에서 정말 추방하시겠습니까?`;

    const confirmed = await showConfirm({
      title: confirmTitle,
      message: confirmMsg,
      type: 'danger',
      confirmText: isSelf ? '탈퇴' : '추방',
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
        setSuccessMsg(`'${userEmail}' 멤버를 워크스페이스에서 추방했습니다.`);
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      await showAlert({
        title: isSelf ? '탈퇴 실패' : '추방 실패',
        message: err.message || '작업을 완료하지 못했습니다.',
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
        className="modal-content workspace-settings-modal-content" 
        onClick={e => e.stopPropagation()} 
      >
        {/* Header */}
        <div className="workspace-modal-header">
          <div className="workspace-modal-title-box">
            <div className="workspace-modal-icon-badge">
              <Briefcase size={20} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 className="workspace-modal-title">
                {isCreateMode ? '새 워크스페이스 만들기' : `${workspace?.name} 관리`}
              </h2>
              <p className="workspace-modal-subtitle">
                {isCreateMode ? '새로운 프로젝트나 팀을 위한 작업 공간을 생성합니다.' : '워크스페이스 기본 정보 및 멤버 권한을 관리합니다.'}
              </p>
            </div>
          </div>
          <button 
            type="button"
            className="btn-icon" 
            onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ 
            padding: '0.65rem 0.85rem', 
            background: 'rgba(244, 63, 94, 0.12)', 
            border: '1px solid rgba(244, 63, 94, 0.25)', 
            borderRadius: 'var(--radius-md)', 
            color: 'var(--accent-rose)', 
            fontSize: '0.8rem', 
            marginBottom: '1rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            fontWeight: 500,
            wordBreak: 'keep-all'
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div style={{ 
            padding: '0.65rem 0.85rem', 
            background: 'rgba(16, 185, 129, 0.12)', 
            border: '1px solid rgba(16, 185, 129, 0.25)', 
            borderRadius: 'var(--radius-md)', 
            color: 'var(--accent-emerald)', 
            fontSize: '0.8rem', 
            marginBottom: '1rem', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            fontWeight: 500,
            wordBreak: 'keep-all'
          }}>
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Tabs for existing workspace */}
        {!isCreateMode && (
          <div className="workspace-tabs-row">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`workspace-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            >
              <Settings size={15} />
              <span>워크스페이스 설정</span>
            </button>

            {/* In the shared workspace this list is everybody who has an
                account, addresses and all — a directory, not a member list.
                Only an administrator has any business reading it, and only an
                administrator can change anything in it. */}
            {canSeeMembers && (
              <button
                type="button"
                onClick={() => setActiveTab('members')}
                className={`workspace-tab-btn ${activeTab === 'members' ? 'active' : ''}`}
              >
                <Users size={15} />
                <span>멤버 관리{memberTotal || members.length ? ` (${memberTotal || members.length})` : ''}</span>
              </button>
            )}
          </div>
        )}

        {/* Tab 1: Settings / Create */}
        {(isCreateMode || activeTab === 'settings') && (
          <form onSubmit={handleSaveSettings}>
            <div style={{ marginBottom: '0.85rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
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
                  padding: '0.55rem 0.75rem',
                  fontSize: '0.88rem',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '0.85rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
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
                  padding: '0.55rem 0.75rem',
                  fontSize: '0.82rem',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  resize: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                아이콘 테마
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem' }}>
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
                        padding: '0.45rem 0.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 3,
                        background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                        border: '1px solid',
                        borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)'
                      }}
                    >
                      <IconComp size={16} />
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {outOfRoom && (
              <div className="ws-no-room">
                <AlertTriangle size={15} />
                <div>
                  <strong>남은 저장 용량이 부족합니다</strong>
                  <span>
                    지금 남은 용량은 {remainingText}입니다. 새 워크스페이스를 만들려면 50MB 이상 남아 있어야 합니다.
                    파일을 정리하거나 최고 관리자에게 용량 증설을 요청해 주세요.
                  </span>
                </div>
              </div>
            )}

            {isAdminOrOwner && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" className="btn-secondary" onClick={onClose} style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}>
                  취소
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isLoading || !name.trim() || outOfRoom}
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.95rem' }}
                >
                  {isCreateMode ? '워크스페이스 생성' : '변경사항 저장'}
                </button>
              </div>
            )}

            {/* Danger Zone: Delete Workspace */}
            {!isCreateMode && isOwner && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(244, 63, 94, 0.2)', paddingTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: workspace.is_shared ? 'var(--text-muted)' : 'var(--accent-rose)' }}>
                      워크스페이스 삭제
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {workspace.is_shared
                        ? '공용 워크스페이스는 삭제할 수 없습니다.'
                        : '포함된 모든 데이터가 영구 삭제됩니다.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDeleteWorkspace}
                    disabled={workspace.is_shared}
                    title={workspace.is_shared ? '공용 워크스페이스는 삭제할 수 없습니다.' : undefined}
                    style={{
                      background: workspace.is_shared ? 'var(--bg-tertiary)' : 'rgba(244, 63, 94, 0.15)',
                      border: workspace.is_shared ? '1px solid var(--border-subtle)' : '1px solid rgba(244, 63, 94, 0.3)',
                      borderRadius: 'var(--radius-md)',
                      color: workspace.is_shared ? 'var(--text-muted)' : 'var(--accent-rose)',
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: workspace.is_shared ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      opacity: workspace.is_shared ? 0.7 : 1
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
            {isSharedWorkspace && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem', wordBreak: 'keep-all', lineHeight: 1.55 }}>
                공용 워크스페이스는 승인된 모든 이용자가 함께 쓰는 공간입니다. 따로 사람을 넣거나 빼지 않고, 쓰기 권한으로 관리합니다.
                쓰기 권한을 회수해도 읽기는 그대로 유지됩니다.
              </div>
            )}

            {/* Search */}
            <div className="workspace-member-search">
              <Search size={14} color="var(--text-muted)" />
              <input
                type="text"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="이름, 아이디, 메일 주소로 찾기"
                aria-label="멤버 검색"
              />
              {memberQuery && (
                <button type="button" className="btn-icon" onClick={() => setMemberQuery('')} title="지우기" style={{ padding: 2 }}>
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Invite Form */}
            {isAdminOrOwner && !isSharedWorkspace && (
              <>
                <form onSubmit={handleInviteMember} className="workspace-member-invite-form">
                  <input
                    type="email"
                    required
                    placeholder="초대할 이메일 (예: teammate@company.com)"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    style={{
                      flex: '1 1 180px',
                      minWidth: 0,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.45rem 0.65rem',
                      fontSize: '0.82rem',
                      color: 'var(--text-primary)',
                      outline: 'none'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <Select
                      value={inviteRole}
                      onChange={setInviteRole}
                      style={{ width: 96 }}
                      options={[
                        { value: 'member', label: '멤버' },
                        ...((isOwner || currentUser?.is_superadmin) ? [{ value: 'admin', label: '관리자' }] : []),
                      ]}
                    />
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={!inviteEmail.trim() || isLoading}
                      style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', whiteSpace: 'nowrap' }}
                    >
                      <UserPlus size={14} />
                      <span>초대</span>
                    </button>
                  </div>
                </form>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: -8, marginBottom: '1rem', wordBreak: 'keep-all' }}>
                  초대 링크는 발송일로부터 7일간 유효합니다.
                </div>
              </>
            )}

            {/* Member List */}
            <div style={{ maxHeight: 260, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
                      padding: '0.5rem 0.65rem',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-md)',
                      marginBottom: 5,
                      gap: '0.5rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                      <img
                        src={m.user_picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${m.user_email}`}
                        alt={m.user_name}
                        style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.user_name || m.user_email?.split('@')[0]}
                            {m.user_username ? ` (@${m.user_username})` : ''}
                          </span>
                          {isMemberOwner && <Crown size={12} color="var(--accent-amber)" style={{ flexShrink: 0 }} title="소유자" />}
                          {isSelf && <span style={{ fontSize: '0.68rem', color: 'var(--accent-primary)', flexShrink: 0 }}>(나)</span>}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.user_email}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                      {/* The shared workspace: what this person may do here,
                          set by an administrator and nobody else. */}
                      {isSharedWorkspace ? (
                        <>
                          <button
                            type="button"
                            className={`member-switch ${member_isAdmin(m) ? 'on' : ''}`}
                            disabled={!isSuperadmin || isSelf || memberBusy === m.user_id}
                            onClick={() => toggleAdmin(m)}
                            title={isSelf ? '본인의 관리자 권한은 여기서 바꿀 수 없습니다.' : (member_isAdmin(m) ? '관리자에서 해제' : '관리자로 임명')}
                          >
                            {memberBusy === m.user_id ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />}
                            <span>{member_isAdmin(m) ? '관리자' : '일반'}</span>
                          </button>
                          <button
                            type="button"
                            className={`member-switch ${member_canWrite(m) ? 'on' : 'off'}`}
                            disabled={!isSuperadmin || member_isAdmin(m) || memberBusy === m.user_id}
                            onClick={() => toggleSharedWrite(m)}
                            title={member_isAdmin(m)
                              ? '관리자는 항상 쓸 수 있습니다.'
                              : (member_canWrite(m) ? '쓰기 권한 회수 (읽기는 유지)' : '쓰기 권한 부여')}
                          >
                            {memberBusy === m.user_id ? <Loader2 size={12} className="spin" /> : (member_canWrite(m) ? <Check size={12} /> : <Ban size={12} />)}
                            <span>{member_canWrite(m) ? '쓰기 가능' : '읽기 전용'}</span>
                          </button>
                        </>
                      ) : isOwner && !isMemberOwner ? (
                        <Select
                          value={m.role}
                          onChange={(v) => handleRoleChange(m.user_id, v)}
                          style={{ width: 96 }}
                          options={[
                            { value: 'member', label: '멤버' },
                            { value: 'admin', label: '관리자' },
                          ]}
                        />
                      ) : (
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: isMemberOwner ? 'var(--accent-amber)' : (m.role === 'admin' ? 'var(--accent-primary)' : 'var(--text-muted)'),
                          background: 'var(--bg-card)',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 'var(--radius-sm)',
                          whiteSpace: 'nowrap'
                        }}>
                          {isMemberOwner ? '소유자' : (m.role === 'admin' ? '관리자' : '멤버')}
                        </span>
                      )}

                      {/* Remove or Leave Button */}
                      {!isSharedWorkspace && !isMemberOwner && (isSelf || isOwner || (isAdminOrOwner && m.role === 'member')) && (
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => handleRemoveMember(m.user_id, m.user_email)}
                          title={isSelf ? "워크스페이스 탈퇴" : "멤버 추방"}
                          style={{ padding: 4 }}
                        >
                          <UserX size={14} color="var(--accent-rose)" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {members.length === 0 && (
                <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {memberQuery ? `'${memberQuery}'와 맞는 사람이 없습니다.` : '표시할 멤버가 없습니다.'}
                </div>
              )}
            </div>

            {memberTotal > 0 && (
              <div className="workspace-member-pager">
                {memberTotal > MEMBER_PAGE_SIZE && (
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={memberPage <= 1}
                    onClick={() => setMemberPage((p) => Math.max(1, p - 1))}
                    title="이전"
                  >
                    <ChevronLeft size={14} />
                  </button>
                )}
                <span>
                  {memberTotal > MEMBER_PAGE_SIZE
                    ? `${memberPage} / ${Math.ceil(memberTotal / MEMBER_PAGE_SIZE)} 쪽 · 전체 ${memberTotal}명`
                    : `전체 ${memberTotal}명`}
                </span>
                {memberTotal > MEMBER_PAGE_SIZE && (
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={memberPage >= Math.ceil(memberTotal / MEMBER_PAGE_SIZE)}
                    onClick={() => setMemberPage((p) => p + 1)}
                    title="다음"
                  >
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
