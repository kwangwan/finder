import React, { useState } from 'react';
import { Clock, ShieldAlert, RefreshCw, LogOut, CheckCircle, Copy, Terminal } from '../../utils/icons';
import { getMe, logout } from '../../api';

export default function PendingApprovalScreen({ user, onApproved, onLogout }) {
  const [isChecking, setIsChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      const refreshedUser = await getMe();
      if (refreshedUser && (refreshedUser.is_approved || refreshedUser.is_admin)) {
        onApproved(refreshedUser);
      }
    } catch (err) {
      console.error('Status check error:', err);
    } finally {
      setIsChecking(false);
    }
  };

  const sqlQuery = `UPDATE kb_users SET is_approved = true WHERE email = '${user?.email}';`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(sqlQuery);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      width: '100vw',
      backgroundColor: 'var(--bg-primary)',
      padding: '1.5rem'
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-lg)',
        padding: '2.5rem 2rem',
        maxWidth: 560,
        width: '100%',
        boxShadow: 'var(--shadow-lg)',
        textAlign: 'center',
        backdropFilter: 'blur(16px)'
      }}>
        {/* Status Icon */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'rgba(245, 158, 11, 0.15)',
          border: '2px solid rgba(245, 158, 11, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem',
          color: 'var(--accent-amber)'
        }}>
          <Clock size={32} />
        </div>

        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
          관리자 승인 대기 중
        </h1>
        
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          <strong>{user?.name || user?.email}</strong> 님의 계정이 정상 등록되었습니다.<br />
          본 시스템(Project Run : Finder)은 비공개 보안 환경으로, 관리자가 승인한 후 접근하실 수 있습니다.
        </p>

        {/* Account Info Pill */}
        <div style={{
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          padding: '0.85rem 1rem',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          textAlign: 'left',
          border: '1px solid var(--border-subtle)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>이메일 계정</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user?.email}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>승인 상태</span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>대기 중 (Pending)</span>
          </div>
        </div>

        {/* SQL Manual Approval Guide for Administrator */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          textAlign: 'left',
          marginBottom: '1.5rem',
          fontSize: '0.78rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Terminal size={14} /> 관리자용 계정 승인 DB 쿼리:
            </span>
            <button 
              className="btn-icon" 
              onClick={handleCopySql} 
              title="쿼리 복사"
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }}
            >
              {copied ? <CheckCircle size={14} color="var(--accent-emerald)" /> : <Copy size={14} />}
            </button>
          </div>
          <code style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
            wordBreak: 'break-all',
            background: 'var(--bg-primary)',
            padding: '0.5rem',
            borderRadius: 'var(--radius-sm)'
          }}>
            {sqlQuery}
          </code>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
            * 최고 관리자는 웹 UI의 <strong>[관리자 콘솔 &gt; 사용자 관리]</strong>에서도 원클릭으로 승인할 수 있습니다.
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button 
            className="btn-primary" 
            onClick={checkStatus} 
            disabled={isChecking}
            style={{ padding: '0.65rem 1.25rem' }}
          >
            <RefreshCw size={16} className={isChecking ? 'spin-anim' : ''} />
            <span>{isChecking ? '확인 중...' : '승인 상태 다시 확인'}</span>
          </button>

          <button 
            className="btn-secondary" 
            onClick={onLogout}
            style={{ padding: '0.65rem 1rem' }}
          >
            <LogOut size={16} />
            <span>로그아웃</span>
          </button>
        </div>
      </div>
    </div>
  );
}
