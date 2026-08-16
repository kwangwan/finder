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
  Edit3
} from 'lucide-react';
import { getAdminUsers, toggleApproveUser, toggleAdminUser, deleteAdminUser, getSystemStats, updateUserQuota } from '../../api';
import { useDialog } from '../../context/DialogContext';

/** Format bytes to human-readable string */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
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
    const confirmTitle = user.is_admin ? '관리자 권한 회수' : '관리자 권한 부여';
    const confirmMsg = user.is_admin 
      ? `'${user.email}' 님의 최고 관리자 권한을 회수하시겠습니까?`
      : `'${user.email}' 님에게 최고 관리자 권한을 부여하시겠습니까?\n관리자는 전체 사용자 및 시스템 설정을 관리할 수 있습니다.`;
    
    const confirmed = await showConfirm({
      title: confirmTitle,
      message: confirmMsg,
      type: user.is_admin ? 'danger' : 'info',
      confirmText: user.is_admin ? '권한 회수' : '권한 부여',
      cancelText: '취소'
    });
    if (!confirmed) return;

    setActionLoadingId(user.id);
    try {
      await toggleAdminUser(user.id, !user.is_admin);
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
        title: '계정 삭제 불가',
        message: '현재 로그인된 본인 계정은 삭제할 수 없습니다.',
        type: 'warning'
      });
      return;
    }
    
    const confirmed = await showConfirm({
      title: '사용자 계정 삭제',
      message: `'${user.email}' 사용자를 정말 삭제하시겠습니까?\n해당 사용자의 모든 데이터와 권한이 영구 삭제됩니다.`,
      type: 'danger',
      confirmText: '계정 삭제',
      cancelText: '취소'
    });
    if (!confirmed) return;

    setActionLoadingId(user.id);
    try {
      await deleteAdminUser(user.id);
      await loadData();
    } catch (err) {
      await showAlert({
        title: '사용자 삭제 실패',
        message: '사용자 계정을 삭제하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleQuotaEdit = (user) => {
    setEditingQuotaUserId(user.id);
    setQuotaInputGb(String(bytesToGb(user.storage_quota_bytes || gbToBytes(100))));
  };

  const handleQuotaSave = async (user) => {
    const gb = parseFloat(quotaInputGb);
    if (isNaN(gb) || gb < 0) {
      await showAlert({
        title: '입력 오류',
        message: '0 이상의 유효한 용량(GB) 숫자를 입력해주세요.',
        type: 'warning'
      });
      return;
    }
    setActionLoadingId(user.id);
    try {
      await updateUserQuota(user.id, gbToBytes(gb));
      setEditingQuotaUserId(null);
      await loadData();
    } catch (err) {
      await showAlert({
        title: '용량 변경 실패',
        message: '저장소 용량을 변경하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredUsers = users.filter(u => 
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.name && u.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const pendingCount = users.filter(u => !u.is_approved && !u.is_admin).length;
  const approvedCount = users.filter(u => u.is_approved || u.is_admin).length;
  const adminCount = users.filter(u => u.is_admin).length;

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      backgroundColor: 'var(--bg-primary)',
      overflowY: 'auto',
      padding: '2rem'
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="btn-icon" onClick={onBackToApp} title="Finder로 돌아가기">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={24} color="var(--accent-primary)" />
                관리자 대시보드
              </h1>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2 }}>
                사용자 승인 · 권한 · 저장용량 관리
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-secondary" onClick={loadData} disabled={isLoading}>
              <RefreshCw size={15} />
              <span>새로고침</span>
            </button>
            <button className="btn-primary" onClick={onBackToApp}>
              <span>Finder 메인</span>
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          {[
            { label: '전체 회원', value: `${users.length}명`, color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' },
            { label: '승인 대기', value: `${pendingCount}명`, color: 'var(--accent-amber)', borderColor: 'rgba(245,158,11,0.3)' },
            { label: '승인 완료', value: `${approvedCount}명`, color: 'var(--accent-emerald)', borderColor: 'rgba(16,185,129,0.3)' },
            { label: '관리자', value: `${adminCount}명`, color: 'var(--accent-primary)', borderColor: 'rgba(59,130,246,0.3)' },
          ].map((stat, i) => (
            <div key={i} style={{
              background: 'var(--bg-secondary)',
              border: `1px solid ${stat.borderColor}`,
              borderRadius: 'var(--radius-lg)',
              padding: '1.1rem 1.25rem',
              boxShadow: 'var(--shadow-sm)'
            }}>
              <div style={{ fontSize: '0.78rem', color: stat.color, marginBottom: 4, fontWeight: 600, opacity: 0.8 }}>
                {stat.label}
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* User Management Table */}
        <div style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-md)'
        }}>
          <div style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={18} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>사용자 관리</h2>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.35rem 0.75rem',
              width: 240
            }}>
              <Search size={14} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="이메일 또는 이름 검색..."
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
                  <th style={{ padding: '0.75rem 1rem' }}>사용자</th>
                  <th style={{ padding: '0.75rem 0.75rem' }}>역할</th>
                  <th style={{ padding: '0.75rem 0.75rem' }}>승인</th>
                  <th style={{ padding: '0.75rem 0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <HardDrive size={13} /> 저장용량
                    </div>
                  </th>
                  <th style={{ padding: '0.75rem 0.75rem' }}>가입일</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
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
                      <tr key={user.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {/* User Info */}
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <img
                              src={user.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.email}`}
                              alt={user.name}
                              style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-tertiary)', flexShrink: 0 }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                                {user.name || user.email.split('@')[0]}
                                {isSelf && (
                                  <span style={{ marginLeft: 4, fontSize: '0.65rem', color: 'var(--accent-primary)', background: 'rgba(59,130,246,0.12)', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius-full)' }}>
                                    나
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{user.email}</div>
                            </div>
                          </div>
                        </td>

                        {/* Role Badge */}
                        <td style={{ padding: '0.75rem 0.75rem' }}>
                          {user.is_admin ? (
                            <span style={{
                              fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-primary)',
                              background: 'rgba(59,130,246,0.12)', padding: '0.15rem 0.4rem',
                              borderRadius: 'var(--radius-full)', border: '1px solid rgba(59,130,246,0.25)'
                            }}>관리자</span>
                          ) : (
                            <span style={{
                              fontSize: '0.72rem', color: 'var(--text-secondary)',
                              background: 'var(--bg-tertiary)', padding: '0.15rem 0.4rem',
                              borderRadius: 'var(--radius-full)'
                            }}>일반</span>
                          )}
                        </td>

                        {/* Approval */}
                        <td style={{ padding: '0.75rem 0.75rem' }}>
                          {isApproved ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-emerald)',
                              background: 'rgba(16,185,129,0.12)', padding: '0.15rem 0.4rem',
                              borderRadius: 'var(--radius-full)'
                            }}>
                              <CheckCircle2 size={12} /> 승인
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-amber)',
                              background: 'rgba(245,158,11,0.12)', padding: '0.15rem 0.4rem',
                              borderRadius: 'var(--radius-full)'
                            }}>
                              <ShieldAlert size={12} /> 대기
                            </span>
                          )}
                        </td>

                        {/* Storage Quota */}
                        <td style={{ padding: '0.75rem 0.75rem' }}>
                          {editingQuotaUserId === user.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="number"
                                value={quotaInputGb}
                                onChange={e => setQuotaInputGb(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleQuotaSave(user); if (e.key === 'Escape') setEditingQuotaUserId(null); }}
                                style={{
                                  width: 60, padding: '0.2rem 0.35rem', fontSize: '0.8rem',
                                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                                  background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none'
                                }}
                                autoFocus
                                min="0"
                                step="1"
                              />
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GB</span>
                              <button className="btn-icon" onClick={() => handleQuotaSave(user)} title="저장" style={{ padding: 2 }}>
                                <Save size={14} color="var(--accent-emerald)" />
                              </button>
                              <button className="btn-icon" onClick={() => setEditingQuotaUserId(null)} title="취소" style={{ padding: 2 }}>
                                <XCircle size={14} color="var(--text-muted)" />
                              </button>
                            </div>
                          ) : (
                            <div style={{ minWidth: 120 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
                                </span>
                                <button className="btn-icon" onClick={() => handleQuotaEdit(user)} title="용량 변경" style={{ padding: 1, opacity: 0.6 }}>
                                  <Edit3 size={11} />
                                </button>
                              </div>
                              <div style={{
                                height: 4, borderRadius: 2, background: 'var(--bg-tertiary)', overflow: 'hidden', width: 100
                              }}>
                                <div style={{
                                  height: '100%', borderRadius: 2, width: `${usagePercent}%`,
                                  background: usagePercent > 90 ? 'var(--accent-rose)' : usagePercent > 70 ? 'var(--accent-amber)' : 'var(--accent-primary)',
                                  transition: 'width 0.3s'
                                }} />
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Registered Date */}
                        <td style={{ padding: '0.75rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          {user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '-'}
                        </td>

                        {/* Action Buttons */}
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                            {!user.is_admin && (
                              <button
                                className="btn-secondary"
                                onClick={() => handleToggleApprove(user)}
                                disabled={actionLoadingId === user.id}
                                style={{
                                  fontSize: '0.72rem', padding: '0.25rem 0.5rem',
                                  color: isApproved ? 'var(--accent-rose)' : 'var(--accent-emerald)'
                                }}
                              >
                                {isApproved ? <UserX size={12} /> : <UserCheck size={12} />}
                                <span>{isApproved ? '해제' : '승인'}</span>
                              </button>
                            )}

                            {!isSelf && (
                              <button
                                className="btn-secondary"
                                onClick={() => handleToggleAdmin(user)}
                                disabled={actionLoadingId === user.id}
                                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                              >
                                <ShieldCheck size={12} />
                                <span>{user.is_admin ? '해제' : '관리자'}</span>
                              </button>
                            )}

                            {!isSelf && (
                              <button
                                className="btn-icon"
                                onClick={() => handleDeleteUser(user)}
                                disabled={actionLoadingId === user.id}
                                title="삭제"
                              >
                                <Trash2 size={14} color="var(--accent-rose)" />
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
