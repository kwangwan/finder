import React, { useCallback, useEffect, useState } from 'react';
import {
  Flag,
  Trash2,
  Check,
  RefreshCw,
  Loader2,
  FileText,
  Folder as FolderIcon,
  User as UserIcon,
  Eye,
} from '../../utils/icons';
import { listReports, resolveReport, getThumbnailUrl } from '../../api';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';

const TABS = [
  { key: 'pending', label: '처리 대기' },
  { key: 'resolved', label: '삭제됨' },
  { key: 'dismissed', label: '기각됨' },
];

function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * The queue an administrator works through.
 *
 * Reporting never removes anything by itself, so this is where the decision
 * actually happens — which means the file has to be judgeable from here.
 * Each row carries the thumbnail or a text excerpt, who uploaded it and where
 * it sits, so the call can be made without opening the file elsewhere and
 * losing the queue.
 */
export default function ReportsExplorer({ onOpenFile, onResolved }) {
  const { showConfirm, showAlert } = useDialog();
  const { showToast } = useToast();
  const [tab, setTab] = useState('pending');
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await listReports(tab);
      setReports(res.reports || []);
    } catch (e) {
      setReports([]);
    } finally {
      setIsLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const act = async (report, action) => {
    if (action === 'delete') {
      const confirmed = await showConfirm({
        title: '신고된 파일 삭제',
        message: `'${report.file?.name}' 파일을 휴지통으로 옮기시겠습니까?\n올린 사람에게 삭제 안내 메일이 발송됩니다.${report.report_count > 1 ? `\n이 파일에 접수된 신고 ${report.report_count}건이 함께 처리됩니다.` : ''}`,
        confirmText: '삭제',
        danger: true,
      });
      if (!confirmed) return;
    }
    setBusyId(report.id);
    try {
      const res = await resolveReport(report.id, action);
      await load();
      onResolved?.();
      if (res.closed > 1) {
        // The card already said how many were attached, and the confirm
        // repeated it — a third dialog to say it a third time is just a click.
        showToast(`신고 ${res.closed}건을 함께 처리했습니다.`, { type: 'success' });
      }
    } catch (e) {
      await showAlert({ title: '처리 실패', message: e.message, type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="reports-explorer">
      <div className="reports-header">
        <div className="reports-title">
          <Flag size={18} color="var(--accent-rose)" />
          <h2>신고 관리</h2>
          {tab === 'pending' && reports.length > 0 && (
            <span className="menu-badge">{reports.length}</span>
          )}
        </div>
        <button type="button" className="btn-secondary" onClick={load} disabled={isLoading}>
          <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
          <span>새로고침</span>
        </button>
      </div>

      <div className="reports-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            className={`reports-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="reports-empty"><Loader2 size={18} className="spin" /><span>불러오는 중...</span></div>
      ) : reports.length === 0 ? (
        <div className="reports-empty">
          <Flag size={28} style={{ opacity: 0.4 }} />
          <span>{tab === 'pending' ? '처리할 신고가 없습니다.' : '해당 상태의 신고가 없습니다.'}</span>
        </div>
      ) : (
        <div className="reports-list">
          {reports.map(r => (
            <div key={r.id} className="report-card">
              <div className="report-preview">
                {r.file?.thumbnail_url ? (
                  <img src={getThumbnailUrl(r.file.id)} alt="" loading="lazy" />
                ) : r.file?.content_preview ? (
                  <div className="report-text-preview">{r.file.content_preview}</div>
                ) : (
                  <div className="report-no-preview"><FileText size={22} /></div>
                )}
              </div>

              <div className="report-body">
                <div className="report-file-name" title={r.file?.name}>
                  {r.file?.name || '(삭제된 파일)'}
                  {r.file?.is_trashed && <span className="report-flag-tag">휴지통</span>}
                </div>

                <div className="report-meta">
                  <span><UserIcon size={12} /> {r.file?.uploader}</span>
                  {r.file?.folder_name && <span><FolderIcon size={12} /> {r.file.folder_name}</span>}
                  {r.file?.size_bytes ? <span>{formatSize(r.file.size_bytes)}</span> : null}
                </div>

                <div className="report-reason">
                  {(r.reason_summary || [{ label: r.reason_label, count: 1 }]).map(s => (
                    <span key={s.label} className="report-reason-tag">
                      {s.label}{s.count > 1 ? ` ${s.count}` : ''}
                    </span>
                  ))}
                  <span className="report-reporter">
                    신고 {r.report_count || 1}건
                    {r.report_count > 1 ? ` · ${(r.reports || []).map(x => x.reporter).join(', ')}` : ` · ${r.reporter}`}
                  </span>
                  <span className="report-date">{r.created_at ? new Date(r.created_at).toLocaleString('ko-KR') : ''}</span>
                </div>

                {/* Every reporter's own words, not just the first. Five people
                    all saying the same thing and five saying different things
                    are different decisions, and the difference is only in
                    what they wrote. */}
                {(r.reports || []).filter(x => x.detail).map(x => (
                  <div key={x.id} className="report-detail">
                    “{x.detail}”
                    {r.report_count > 1 && <span className="report-detail-by"> — {x.reporter}</span>}
                  </div>
                ))}
                {!(r.reports || []).length && r.detail && <div className="report-detail">“{r.detail}”</div>}
              </div>

              <div className="report-actions">
                {r.file && !r.file.is_trashed && (
                  <button type="button" className="btn-secondary" onClick={() => onOpenFile?.(r.file)} title="파일 열어보기">
                    <Eye size={14} />
                    <span className="hide-mobile">열기</span>
                  </button>
                )}
                {r.status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyId === r.id}
                      onClick={() => act(r, 'dismiss')}
                      title="문제 없음으로 종료"
                    >
                      <Check size={14} />
                      <span className="hide-mobile">기각</span>
                    </button>
                    <button
                      type="button"
                      className="btn-secondary report-delete"
                      disabled={busyId === r.id}
                      onClick={() => act(r, 'delete')}
                      title="휴지통으로 이동"
                    >
                      {busyId === r.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                      <span className="hide-mobile">삭제</span>
                    </button>
                  </>
                ) : (
                  <span className="report-resolved-tag">
                    {r.resolution === 'delete' ? '삭제 처리' : '기각'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
