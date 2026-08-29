import React, { useEffect, useState } from 'react';
import { Users, X, Loader2, Trash2, UserPlus } from '../../utils/icons';
import { listFolderGrants, addFolderGrant, removeFolderGrant } from '../../api';

/**
 * Who else may write inside this folder.
 *
 * Granted by the owner rather than by an administrator: the owner is the one
 * who knows who should be working on their material, and routing every request
 * through an administrator would turn collaboration into a queue.
 */
export default function FolderShareModal({ isOpen, folder, onClose }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!folder?.id) return;
    setIsLoading(true);
    setError('');
    try {
      setData(await listFolderGrants(folder.id));
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isOpen) { setEmail(''); load(); } }, [isOpen, folder?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !folder) return null;

  const add = async () => {
    if (!email.trim()) return;
    setIsAdding(true);
    setError('');
    try {
      await addFolderGrant(folder.id, email.trim());
      setEmail('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-content dialog-modal modal-self-padded"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 480, width: '92vw', padding: 0, overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}
      >
        <div className="dialog-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <div style={{
              width: 38, height: 38, borderRadius: 'var(--radius-md)', flexShrink: 0,
              background: 'rgba(59, 130, 246, 0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Users size={18} color="var(--accent-primary)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>폴더 공유</h3>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {data?.folder_name || folder.name}
              </div>
            </div>
            <button className="btn-icon" onClick={onClose} title="닫기 (ESC)" style={{ padding: '0.25rem', color: 'var(--text-muted)' }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ marginTop: '0.85rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            권한을 받은 사람은 이 폴더와 <strong>하위 폴더 전체</strong>에 파일을 올리고 수정·삭제할 수 있습니다.
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: '0.8rem' }}>
            <input
              className="input-field"
              type="email"
              placeholder="초대할 사용자의 이메일"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
            />
            <button type="button" className="btn-primary" onClick={add} disabled={isAdding || !email.trim()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 0.8rem', whiteSpace: 'nowrap' }}>
              {isAdding ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
              <span>추가</span>
            </button>
          </div>
          {error && <div style={{ marginTop: 6, fontSize: '0.76rem', color: 'var(--accent-rose)' }}>{error}</div>}

          <div style={{ marginTop: '0.9rem' }}>
            {isLoading ? (
              <div style={{ padding: '1.2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Loader2 size={16} className="spin" />
              </div>
            ) : !data?.grants?.length ? (
              <div style={{ padding: '1.1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                아직 공유한 사용자가 없습니다.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {data.grants.map(g => (
                  <div key={g.user_id} className="folder-grant-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="folder-grant-name">{g.name}</div>
                      <div className="folder-grant-email">{g.email}</div>
                    </div>
                    <button
                      type="button"
                      className="btn-icon"
                      title="권한 회수"
                      onClick={async () => {
                        try { await removeFolderGrant(folder.id, g.user_id); await load(); }
                        catch (e) { setError(e.message); }
                      }}
                      style={{ color: 'var(--accent-rose)', padding: 4 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dialog-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
