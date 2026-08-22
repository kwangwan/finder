import React, { useState, useEffect } from 'react';
import { 
  Users, 
  ShieldCheck, 
  ShieldAlert, 
  UserCheck, 
  UserX, 
  Trash2, 
  RefreshCw, 
  ArrowLeft, 
  HardDrive, 
  CheckCircle2,
  XCircle,
  Search,
  Save,
  Edit3,
  Shield,
  User as UserIcon,
  Clock,
  Database
} from '../../utils/icons';
import { getAdminUsers, toggleApproveUser, toggleAdminUser, deleteAdminUser, getSystemStats, updateUserQuota } from '../../api';
import { useDialog } from '../../context/DialogContext';

/** Format bytes to human-readable string */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** GB 단위를 bytes로 변환 */
function gbToBytes(gb) {
  return gb * 1024 * 1024 * 1024;
}
function bytesToGb(bytes) {
  return parseFloat((bytes / (1024 * 1024 * 1024)).toFixed(1));
}

export default function AdminDashboard({ currentUser, onBackToApp }) {
  const { showAlert, showConfirm } = useDialog();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState(null);
  // quota editing
  const [editingQuotaUserId, setEditingQuotaUserId] = useState(null);
  const [quotaInputGb, setQuotaInputGb] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [userList, sysStats] = await Promise.all([
        getAdminUsers(),
        getSystemStats()
      ]);
      setUsers(userList);
      setStats(sysStats);
    } catch (err) {
      await showAlert({
        title: '데이터 조회 실패',
        message: '관리자 데이터를 불러오지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle browser back button as well as UI back button
  useEffect(() => {
    window.history.pushState({ view: 'admin' }, '');
    const handlePopState = () => {
      if (onBackToApp) onBackToApp();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onBackToApp]);

  const handleToggleApprove = async (user) => {
    setActionLoadingId(user.id);
    try {
      await toggleApproveUser(user.id, !user.is_approved);
      await loadData();
    } catch (err) {
      await showAlert({
        title: '상태 변경 실패',
        message: '가입 승인 상태를 변경하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleAdmin = async (user) => {
    if (user.id === currentUser.id) {
      await showAlert({
        title: '권한 변경 불가',
        message: '본인의 최고 관리자 권한은 스스로 해제할 수 없습니다.',
        type: 'warning'
      });
      return;
    }

    const newAdminStatus = !user.is_admin;
    const confirmed = await showConfirm({
      title: newAdminStatus ? '최고 관리자 권한 부여' : '최고 관리자 권한 해제',
      message: newAdminStatus 
        ? `'${user.name || user.email}'님에게 최고 관리자 권한을 부여하시겠습니까?\n모든 워크스페이스 및 시스템 설정에 접근할 수 있게 됩니다.`
        : `'${user.name || user.email}'님의 최고 관리자 권한을 해제하시겠습니까?`,
      type: newAdminStatus ? 'info' : 'danger',
      confirmText: newAdminStatus ? '권한 부여' : '권한 해제',
      cancelText: '취소'
    });
    if (!confirmed) return;

    setActionLoadingId(user.id);
    try {
      await toggleAdminUser(user.id, newAdminStatus);
      await loadData();
    } catch (err) {
      await showAlert({
        title: '권한 변경 실패',
        message: '관리자 권한을 변경하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteUser = async (user) => {
    if (user.id === currentUser.id) {
      await showAlert({
        title: '삭제 불가',
        message: '본인 계정은 삭제할 수 없습니다.',
        type: 'warning'
      });
      return;
    }

    const confirmed = await showConfirm({
      title: '사용자 영구 삭제',
      message: `'${user.name || user.email}' 계정을 영구 삭제하시겠습니까?\n해당 사용자의 모든 업로드 파일 및 메모가 영구 삭제될 수 있으며 복구할 수 없습니다.`,
      type: 'danger',
      confirmText: '영구 삭제',
      cancelText: '취소'
    });
    if (!confirmed) return;

    setActionLoadingId(user.id);
    try {
      await deleteAdminUser(user.id);
      await loadData();
    } catch (err) {
      await showAlert({
        title: '계정 삭제 실패',
        message: '계정을 삭제하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleStartEditQuota = (user) => {
    setEditingQuotaUserId(user.id);
    const gb = user.storage_quota_bytes ? bytesToGb(user.storage_quota_bytes) : 0;
    setQuotaInputGb(gb.toString());
  };

  const handleSaveQuota = async (userId) => {
    const gbVal = parseFloat(quotaInputGb);
    if (isNaN(gbVal) || gbVal < 0) {
      await showAlert({
        title: '입력 오류',
        message: '유효한 용량(GB)을 입력해주세요. (0 이상)',
        type: 'warning'
      });
      return;
    }

    const bytes = gbToBytes(gbVal);
    setActionLoadingId(userId);
    try {
      await updateUserQuota(userId, bytes);
      setEditingQuotaUserId(null);
      await loadData();
    } catch (err) {
      await showAlert({
        title: '할당량 변경 실패',
        message: '스토리지 용량을 변경하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancelEditQuota = () => {
    setEditingQuotaUserId(null);
    setQuotaInputGb('');
  };

  const filteredUsers = users.filter(u => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q))
    );
  });

  const pendingCount = users.filter(u => !u.is_approved && !u.is_admin).length;
  const approvedCount = users.filter(u => u.is_approved || u.is_admin).length;
  const adminCount = users.filter(u => u.is_admin).length;

  return (
    <div className="admin-dashboard-container">
      <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {/* Header */}
        <div className="admin-dashboard-header">
          <div className="admin-header-left">
            <button 
              type="button"
              className="btn-icon admin-back-btn" 
              onClick={(e) => {
                e.stopPropagation();
                if (onBackToApp) onBackToApp();
              }} 
              title="Finder로 돌아가기"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="admin-header-brand-wrap">
              <div className="admin-shield-icon">
                <ShieldCheck size={22} />
              </div>
              <div className="admin-header-title-box">
                <h1 className="admin-main-title">
                  최고 관리자 대시보드
                </h1>
                <p className="admin-sub-title">
                  전체 사용자 계정 승인 · 권한 부여 · 스토리지 관리
                </p>
              </div>
            </div>
          </div>

          <button 
            type="button"
            className="btn-secondary admin-refresh-btn" 
            onClick={loadData} 
            disabled={isLoading}
          >
            <RefreshCw size={14} className={isLoading ? 'spin-anim' : ''} />
            <span>새로고침</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="admin-stats-grid">
          {[
            { label: '전체 등록 회원', value: `${users.length}명`, icon: Users, color: 'var(--text-primary)', bg: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)' },
            { label: '가입 승인 대기', value: `${pendingCount}명`, icon: Clock, color: 'var(--accent-amber)', bg: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.3)' },
            { label: '승인 완료 회원', value: `${approvedCount}명`, icon: CheckCircle2, color: 'var(--accent-emerald)', bg: 'rgba(16, 185, 129, 0.05)', borderColor: 'rgba(16, 185, 129, 0.3)' },
            { label: '최고 관리자', value: `${adminCount}명`, icon: Shield, color: 'var(--accent-primary)', bg: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.3)' },
          ].map((stat, i) => {
            const IconComponent = stat.icon;
            return (
              <div 
                key={i} 
                className="admin-stat-card"
                style={{
                  background: stat.bg,
                  border: `1px solid ${stat.borderColor}`
                }}
              >
                <div>
                  <div className="admin-stat-label">
                    {stat.label}
                  </div>
                  <div className="admin-stat-value" style={{ color: stat.color }}>
                    {stat.value}
                  </div>
                </div>
                <div className="admin-stat-icon-wrap" style={{ color: stat.color }}>
                  <IconComponent size={18} />
                </div>
              </div>
            );
          })}
        </div>

        {/* User Management Table Card */}
        <div className="admin-table-card">
          <div className="admin-table-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Users size={18} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                사용자 계정 목록
              </h2>
              <span className="menu-badge" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
                {filteredUsers.length}명
              </span>
            </div>

            <div className="admin-search-box">
              <Search size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <input
                type="text"
                placeholder="이메일 또는 이름으로 검색..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  width: '100%'
                }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.9rem 1.5rem', fontWeight: 600, fontSize: '0.78rem' }}>사용자 정보</th>
                  <th style={{ padding: '0.9rem 1rem', fontWeight: 600, fontSize: '0.78rem' }}>시스템 권한</th>
                  <th style={{ padding: '0.9rem 1rem', fontWeight: 600, fontSize: '0.78rem' }}>가입 승인</th>
                  <th style={{ padding: '0.9rem 1rem', fontWeight: 600, fontSize: '0.78rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <HardDrive size={13} /> 저장용량 할당
                    </div>
                  </th>
                  <th style={{ padding: '0.9rem 1rem', fontWeight: 600, fontSize: '0.78rem' }}>가입일시</th>
                  <th style={{ padding: '0.9rem 1.5rem', textAlign: 'right', fontWeight: 600, fontSize: '0.78rem' }}>계정 관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <Users size={32} style={{ margin: '0 auto 0.6rem', display: 'block', opacity: 0.5 }} />
                      일치하는 사용자가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => {
                    const isSelf = user.id === currentUser.id;
                    const isApproved = user.is_approved || user.is_admin;
                    const quotaBytes = user.storage_quota_bytes || gbToBytes(100);
                    const usedBytes = user.storage_used_bytes || 0;
                    const usagePercent = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;

                    return (
                      <tr key={user.id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background-color 0.15s ease' }}>
                        {/* User Info */}
                        <td style={{ padding: '1rem 1.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <img
                              src={user.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.email}`}
                              alt={user.name}
                              style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', flexShrink: 0 }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span>{user.name || user.email.split('@')[0]}</span>
                                {isSelf && (
                                  <span style={{ 
                                    fontSize: '0.68rem', 
                                    color: 'var(--accent-primary)', 
                                    background: 'rgba(59,130,246,0.12)', 
                                    border: '1px solid rgba(59,130,246,0.25)',
                                    padding: '0.1rem 0.4rem', 
                                    borderRadius: 'var(--radius-full)' 
                                  }}>
                                    본인
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, marginTop: 2 }}>
                                {user.email}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Role Badge */}
                        <td style={{ padding: '1rem 1rem' }}>
                          {user.is_admin ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: '0.75rem', 
                              fontWeight: 700, 
                              color: 'var(--accent-primary)',
                              background: 'rgba(59,130,246,0.12)', 
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)', 
                              border: '1px solid rgba(59,130,246,0.3)'
                            }}>
                              <ShieldCheck size={13} /> 최고 관리자
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: '0.75rem', 
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              background: 'var(--bg-tertiary)', 
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              border: '1px solid var(--border-subtle)'
                            }}>
                              <UserIcon size={13} /> 일반 멤버
                            </span>
                          )}
                        </td>

                        {/* Approval */}
                        <td style={{ padding: '1rem 1rem' }}>
                          {isApproved ? (
                            <span style={{
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: 4,
                              fontSize: '0.75rem', 
                              fontWeight: 700, 
                              color: 'var(--accent-emerald)',
                              background: 'rgba(16,185,129,0.12)', 
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              border: '1px solid rgba(16,185,129,0.3)'
                            }}>
                              <CheckCircle2 size={13} /> 승인 완료
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: 4,
                              fontSize: '0.75rem', 
                              fontWeight: 700, 
                              color: 'var(--accent-amber)',
                              background: 'rgba(245,158,11,0.12)', 
                              padding: '0.2rem 0.55rem',
                              borderRadius: 'var(--radius-full)',
                              border: '1px solid rgba(245,158,11,0.3)'
                            }}>
                              <Clock size={13} /> 승인 대기
                            </span>
                          )}
                        </td>

                        {/* Storage Quota */}
                        <td style={{ padding: '1rem 1rem' }}>
                          {editingQuotaUserId === user.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="number"
                                value={quotaInputGb}
                                onChange={e => setQuotaInputGb(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveQuota(user.id); if (e.key === 'Escape') setEditingQuotaUserId(null); }}
                                style={{
                                  width: 68, 
                                  height: 32,
                                  padding: '0 0.5rem', 
                                  fontSize: '0.85rem',
                                  border: '1px solid var(--accent-primary)', 
                                  borderRadius: 'var(--radius-sm)',
                                  background: 'var(--bg-tertiary)', 
                                  color: 'var(--text-primary)', 
                                  outline: 'none'
                                }}
                                autoFocus
                                min="0"
                                step="1"
                              />
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>GB</span>
                              <button 
                                className="btn-icon" 
                                onClick={() => handleSaveQuota(user.id)}
                                title="저장" 
                                style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(16,185,129,0.12)' }}
                              >
                                <Save size={14} color="var(--accent-emerald)" />
                              </button>
                              <button 
                                className="btn-icon" 
                                onClick={() => setEditingQuotaUserId(null)} 
                                title="취소" 
                                style={{ width: 28, height: 28, borderRadius: 6 }}
                              >
                                <XCircle size={14} color="var(--text-muted)" />
                              </button>
                            </div>
                          ) : (
                            <div style={{ minWidth: 140 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                  {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
                                </span>
                                <button 
                                  className="btn-icon" 
                                  onClick={() => handleStartEditQuota(user)}
                                  title="용량 수정" 
                                  style={{ width: 22, height: 22, padding: 0 }}
                                >
                                  <Edit3 size={12} />
                                </button>
                              </div>
                              <div style={{
                                height: 5, 
                                borderRadius: 3, 
                                background: 'var(--bg-tertiary)', 
                                overflow: 'hidden', 
                                width: 120
                              }}>
                                <div style={{
                                  height: '100%', 
                                  borderRadius: 3, 
                                  width: `${usagePercent}%`,
                                  background: usagePercent > 90 ? 'var(--accent-rose)' : usagePercent > 70 ? 'var(--accent-amber)' : 'var(--accent-primary)',
                                  transition: 'width 0.3s'
                                }} />
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Registered Date */}
                        <td style={{ padding: '1rem 1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          {user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-'}
                        </td>

                        {/* Action Buttons */}
                        <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                            {!user.is_admin && (
                              <button
                                className="btn-secondary"
                                onClick={() => handleToggleApprove(user)}
                                disabled={actionLoadingId === user.id}
                                style={{
                                  height: 32,
                                  fontSize: '0.78rem', 
                                  padding: '0 0.65rem',
                                  color: isApproved ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}
                              >
                                {isApproved ? <UserX size={13} /> : <UserCheck size={13} />}
                                <span>{isApproved ? '승인 취소' : '승인'}</span>
                              </button>
                            )}

                            {!isSelf && (
                              <button
                                className="btn-secondary"
                                onClick={() => handleToggleAdmin(user)}
                                disabled={actionLoadingId === user.id}
                                style={{ 
                                  height: 32,
                                  fontSize: '0.78rem', 
                                  padding: '0 0.65rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}
                              >
                                <ShieldCheck size={13} />
                                <span>{user.is_admin ? '관리자 해제' : '관리자 지정'}</span>
                              </button>
                            )}

                            {!isSelf && (
                              <button
                                className="btn-icon"
                                onClick={() => handleDeleteUser(user)}
                                disabled={actionLoadingId === user.id}
                                title="계정 삭제"
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
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
