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
  Database,
  Copy,
  ArrowRight,
  Users as UsersIcon,
  Check,
  X as XIcon
} from '../../utils/icons';
import { getAdminUsers, toggleApproveUser, toggleAdminUser, deleteAdminUser, getSystemStats, updateUserQuota, listAdminCopyJobs, getSharedWorkspaceInfo, setSharedWorkspaceQuota, setUserSharedWrite, getSharedPolicy, updateSharedPolicy } from '../../api';
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
  const [copyJobs, setCopyJobs] = useState([]);
  const [sharedInfo, setSharedInfo] = useState(null);
  const [sharedQuotaGb, setSharedQuotaGb] = useState('');
  const [isEditingSharedQuota, setIsEditingSharedQuota] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [policyDraft, setPolicyDraft] = useState(null);
  const [todayUsage, setTodayUsage] = useState([]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [userList, sysStats, jobs, shared, pol] = await Promise.all([
        getAdminUsers(),
        getSystemStats(),
        // Best-effort: the history is supplementary, and failing to load it
        // must not take the whole dashboard down with it.
        listAdminCopyJobs(100).catch(() => ({ jobs: [] })),
        getSharedWorkspaceInfo().catch(() => null),
        getSharedPolicy().catch(() => null)
      ]);
      setUsers(userList);
      setStats(sysStats);
      setCopyJobs(jobs.jobs || []);
      setSharedInfo(shared);
      if (pol) {
        setPolicy(pol.settings);
        setTodayUsage(pol.today || []);
        setPolicyDraft({
          daily_limit_mb: Math.round((pol.settings['shared.daily_limit_bytes'] || 0) / (1024 * 1024)),
          max_file_mb: Math.round((pol.settings['shared.max_file_bytes'] || 0) / (1024 * 1024)),
          new_account_days: pol.settings['shared.new_account_days'] ?? 7,
          new_account_daily_limit_mb: Math.round((pol.settings['shared.new_account_daily_limit_bytes'] || 0) / (1024 * 1024)),
          alert_threshold_percent: pol.settings['shared.alert_threshold_percent'] ?? 90,
          blocked_extensions: (pol.settings['shared.blocked_extensions'] || []).join(', '),
        });
      }
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
        {/* The shared workspace's storage is its own pool, not any person's.
            The whole point of that space is to serve users who have not been
            granted personal storage, so charging it to an individual would
            defeat it — it is held by a system account and sized here. */}
        {sharedInfo && (
          <div className="admin-table-card" style={{ marginBottom: '1.5rem' }}>
            <div className="admin-table-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <UsersIcon size={18} color="var(--accent-primary)" />
                <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {sharedInfo.workspace?.name || '공용 워크스페이스'}
                </h2>
                <span className="menu-badge" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
                  파일 {sharedInfo.file_count}개
                </span>
              </div>
            </div>
            <div style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 6 }}>
                  <span style={{ color: 'var(--text-muted)' }}>사용 중</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                    {formatBytes(sharedInfo.storage_used_bytes)} / {formatBytes(sharedInfo.storage_quota_bytes)}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, sharedInfo.storage_quota_bytes ? (sharedInfo.storage_used_bytes / sharedInfo.storage_quota_bytes) * 100 : 0)}%`,
                    height: '100%',
                    background: 'var(--accent-primary)'
                  }} />
                </div>
                <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  가입한 모든 이용자가 함께 사용합니다. 개인 용량과는 별개로 관리됩니다.
                </div>
              </div>

              {isEditingSharedQuota ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    value={sharedQuotaGb}
                    onChange={(e) => setSharedQuotaGb(e.target.value)}
                    style={{ width: 96, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                    autoFocus
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>GB</span>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: '0.4rem 0.7rem' }}
                    onClick={async () => {
                      const gb = Number(sharedQuotaGb);
                      if (!Number.isFinite(gb) || gb < 0) return;
                      try {
                        await setSharedWorkspaceQuota(Math.round(gb * 1024 * 1024 * 1024));
                        setIsEditingSharedQuota(false);
                        await loadData();
                      } catch (err) {
                        await showAlert({ title: '변경 실패', message: err.message, type: 'error' });
                      }
                    }}
                  >
                    <Check size={14} />
                  </button>
                  <button type="button" className="btn-secondary" style={{ padding: '0.4rem 0.7rem' }} onClick={() => setIsEditingSharedQuota(false)}>
                    <XIcon size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '0.45rem 0.8rem', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 5 }}
                  onClick={() => {
                    setSharedQuotaGb(String(Math.round((sharedInfo.storage_quota_bytes / (1024 ** 3)) * 10) / 10));
                    setIsEditingSharedQuota(true);
                  }}
                >
                  <Edit3 size={14} />
                  <span>용량 변경</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Shared workspace rules. These bound what one ordinary account can do
            to a space everyone depends on, and they are settings rather than
            constants because the right numbers depend on how the service is
            actually being used. */}
        {policyDraft && (
          <div className="admin-table-card" style={{ marginBottom: '1.5rem' }}>
            <div className="admin-table-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Shield size={18} color="var(--accent-primary)" />
                <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>공용 워크스페이스 이용 정책</h2>
              </div>
            </div>
            <div style={{ padding: '1.1rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
              {[
                ['daily_limit_mb', '1인당 하루 업로드 한도', 'MB', '한 사람이 하루에 올릴 수 있는 총량입니다.'],
                ['max_file_mb', '파일 하나 최대 크기', 'MB', null],
                ['new_account_days', '신규 계정 기간', '일', '가입 후 이 기간에는 아래 한도가 적용됩니다.'],
                ['new_account_daily_limit_mb', '신규 계정 하루 한도', 'MB', '기간이 지나면 자동으로 정상 한도가 됩니다.'],
                ['alert_threshold_percent', '용량 경고 기준', '%', '이 비율을 넘으면 모든 최고 관리자에게 메일을 보냅니다.'],
              ].map(([key, label, unit, hint]) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                    {label}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input
                      className="input-field"
                      type="number"
                      min="0"
                      value={policyDraft[key]}
                      onChange={(e) => setPolicyDraft(d => ({ ...d, [key]: e.target.value }))}
                      style={{ width: '100%', padding: '0.4rem 0.55rem', fontSize: '0.85rem' }}
                    />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{unit}</span>
                  </div>
                  {hint && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
                </div>
              ))}

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                  차단할 확장자 (쉼표로 구분)
                </label>
                <input
                  className="input-field"
                  value={policyDraft.blocked_extensions}
                  onChange={(e) => setPolicyDraft(d => ({ ...d, blocked_extensions: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.55rem', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                  onClick={async () => {
                    try {
                      await updateSharedPolicy({
                        daily_limit_bytes: Math.max(0, Number(policyDraft.daily_limit_mb) || 0) * 1024 * 1024,
                        max_file_bytes: Math.max(0, Number(policyDraft.max_file_mb) || 0) * 1024 * 1024,
                        new_account_days: Math.max(0, Number(policyDraft.new_account_days) || 0),
                        new_account_daily_limit_bytes: Math.max(0, Number(policyDraft.new_account_daily_limit_mb) || 0) * 1024 * 1024,
                        alert_threshold_percent: Math.min(100, Math.max(1, Number(policyDraft.alert_threshold_percent) || 90)),
                        blocked_extensions: policyDraft.blocked_extensions.split(',').map(x => x.trim()).filter(Boolean),
                      });
                      await loadData();
                    } catch (err) {
                      await showAlert({ title: '저장 실패', message: err.message, type: 'error' });
                    }
                  }}
                >
                  정책 저장
                </button>
              </div>

              {todayUsage.length > 0 && (
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                    오늘 업로드가 많은 이용자
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'flex-start' }}>
                    {todayUsage.map((u, i) => (
                      <span key={i} className="menu-badge" style={{ fontSize: '0.72rem' }}>
                        {u.user_name} · {formatBytes(u.bytes_used)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
                  <th style={{ padding: '0.9rem 1rem', fontWeight: 600, fontSize: '0.78rem' }}>공용 쓰기</th>
                  <th style={{ padding: '0.9rem 1rem', fontWeight: 600, fontSize: '0.78rem' }}>가입일시</th>
                  <th style={{ padding: '0.9rem 1.5rem', textAlign: 'right', fontWeight: 600, fontSize: '0.78rem' }}>계정 관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
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

                        {/* Shared workspace write access. Withdrawing it is how
                            misuse is handled: the user keeps read access, because
                            for someone without personal storage the shared space
                            is their entire account. */}
                        <td style={{ padding: '1rem 1rem' }}>
                          {user.is_admin ? (
                            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>최고 관리자</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={actionLoadingId === user.id}
                              onClick={async () => {
                                const next = !(user.can_write_shared !== false);
                                if (!next) {
                                  const confirmed = await showConfirm({
                                    title: '공용 워크스페이스 쓰기 권한 회수',
                                    message: `'${user.email}' 사용자의 쓰기 권한을 회수하시겠습니까?\n읽기는 계속 가능하며, 새로 올리거나 수정·삭제할 수 없게 됩니다.`,
                                    confirmText: '회수',
                                    danger: true,
                                  });
                                  if (!confirmed) return;
                                }
                                setActionLoadingId(user.id);
                                try {
                                  await setUserSharedWrite(user.id, next);
                                  await loadData();
                                } catch (err) {
                                  await showAlert({ title: '변경 실패', message: err.message, type: 'error' });
                                } finally {
                                  setActionLoadingId(null);
                                }
                              }}
                              style={{
                                padding: '0.3rem 0.6rem',
                                fontSize: '0.75rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                color: user.can_write_shared === false ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                              }}
                              title={user.can_write_shared === false ? '쓰기 권한 부여' : '쓰기 권한 회수 (읽기는 유지)'}
                            >
                              {user.can_write_shared === false ? <XIcon size={13} /> : <Check size={13} />}
                              <span>{user.can_write_shared === false ? '읽기 전용' : '쓰기 가능'}</span>
                            </button>
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
                                <span>{user.is_admin ? '최고 관리자 해제' : '최고 관리자 지정'}</span>
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

        {/* Copy / move history.
            The per-user banner only surfaces what is running or just finished,
            which is the right scope while working but no help afterwards —
            after a large migration between workspaces someone has to be able
            to confirm what actually ran, by whom, and whether any of it
            failed. */}
        <div className="admin-table-card" style={{ marginTop: '1.5rem' }}>
          <div className="admin-table-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Copy size={18} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                복사 · 이동 작업 이력
              </h2>
              <span className="menu-badge" style={{ fontSize: '0.72rem', padding: '2px 7px' }}>
                {copyJobs.length}건
              </span>
            </div>
          </div>

          {copyJobs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              아직 실행된 복사 작업이 없습니다.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    {['대상', '요청자', '경로', '결과', '시각'].map((h, i) => (
                      <th key={h} style={{ padding: i === 0 ? '0.9rem 1.5rem' : '0.9rem 1rem', fontWeight: 600, fontSize: '0.78rem' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {copyJobs.map((j) => {
                    const tone = j.status === 'failed' ? 'var(--accent-rose)'
                      : j.status === 'cancelled' ? 'var(--text-muted)'
                      : j.status === 'done' ? 'var(--accent-emerald)'
                      : 'var(--accent-amber)';
                    const label = { done: '완료', failed: '실패', cancelled: '취소됨', running: '진행 중', pending: '대기 중', cancelling: '취소하는 중' }[j.status] || j.status;
                    return (
                      <tr key={j.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.8rem 1.5rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{j.summary || '-'}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {j.is_move ? '이동' : '복사'}{j.cross_workspace ? ' · 워크스페이스 간' : ''}
                          </div>
                        </td>
                        <td style={{ padding: '0.8rem 1rem', fontSize: '0.8rem' }}>{j.user_name || j.user_email || '-'}</td>
                        <td style={{ padding: '0.8rem 1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            {j.source_workspace || '-'}
                            <ArrowRight size={11} />
                            {j.target_workspace || '-'}
                          </span>
                        </td>
                        <td style={{ padding: '0.8rem 1rem', fontSize: '0.78rem' }}>
                          <span style={{ color: tone, fontWeight: 700 }}>{label}</span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            {' · '}파일 {j.copied_files}/{j.total_files}
                            {j.copied_folders ? `, 폴더 ${j.copied_folders}` : ''}
                            {j.skipped ? `, 제외 ${j.skipped}` : ''}
                            {j.trashed_files ? `, 원본 휴지통 ${j.trashed_files}` : ''}
                          </span>
                          {j.error_message && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--accent-rose)' }} title={j.error_message}>
                              {j.error_message.slice(0, 80)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.8rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {j.created_at ? new Date(j.created_at).toLocaleString('ko-KR') : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
