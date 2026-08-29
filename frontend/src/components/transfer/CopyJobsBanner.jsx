import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, X, Check, AlertCircle, Loader2 } from '../../utils/icons';
import { listCopyJobs, dismissCopyJob } from '../../api';

// Fast enough to feel live while something is copying; the idle poll is slow
// because an empty queue is the normal state and there is nothing to watch.
const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 20000;

// A finished row has said what it needed to; leaving it up means a day's worth
// of completions stacked over the page. It retires itself shortly after being
// seen — the job record itself lives on server-side, so nothing is lost.
const DONE_LINGER_MS = 8000;
// Never let the stack grow past this, however many finished at once.
const MAX_VISIBLE = 3;

function pct(job) {
  if (!job.total_files) return job.status === 'done' ? 100 : 0;
  return Math.min(100, Math.round((job.copied_files / job.total_files) * 100));
}

/**
 * Shows copies running on the server.
 *
 * Copies are queued and processed by the backend, so they continue after the
 * tab is closed — which means the UI has to be able to *find* work it did not
 * start. This polls the queue rather than tracking jobs it launched, so
 * reopening the app mid-copy still shows the progress, and a job that finished
 * while away is still reported instead of vanishing silently.
 */
export default function CopyJobsBanner({ onJobsFinished }) {
  const [jobs, setJobs] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const activeIdsRef = useRef(new Set());
  const retireTimersRef = useRef(new Map());

  const poll = useCallback(async () => {
    try {
      const res = await listCopyJobs();
      const list = res.jobs || [];
      setJobs(list);

      // Tell the app when work actually finished, so the file list and any
      // open folder windows reload — the copies landed on the server without
      // this client doing anything.
      const nowActive = new Set(list.filter((j) => j.status === 'pending' || j.status === 'running').map((j) => j.id));
      const finished = [...activeIdsRef.current].filter((id) => !nowActive.has(id));
      activeIdsRef.current = nowActive;
      if (finished.length) onJobsFinished?.();
    } catch (e) { /* best-effort: a failed poll just retries */ }
  }, [onJobsFinished]);

  // Retire finished rows on a timer rather than on the next poll, so one that
  // completes while the queue is idle still goes away promptly.
  useEffect(() => {
    const timers = retireTimersRef.current;
    jobs.forEach((job) => {
      const finished = job.status === 'done' || job.status === 'failed';
      // Failures stay until acknowledged: they are the one outcome the user
      // has to actually read.
      if (!finished || job.status === 'failed' || timers.has(job.id) || dismissed.has(job.id)) return;
      timers.set(job.id, setTimeout(() => {
        timers.delete(job.id);
        setDismissed((prev) => new Set([...prev, job.id]));
      }, DONE_LINGER_MS));
    });
  }, [jobs, dismissed]);

  useEffect(() => () => {
    retireTimersRef.current.forEach((t) => clearTimeout(t));
    retireTimersRef.current.clear();
  }, []);

  useEffect(() => {
    poll();
    let timer = null;
    const tick = async () => {
      if (document.visibilityState === 'visible') await poll();
      const active = activeIdsRef.current.size > 0;
      timer = setTimeout(tick, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    timer = setTimeout(tick, ACTIVE_POLL_MS);
    return () => clearTimeout(timer);
  }, [poll]);

  const visible = jobs.filter((j) => !dismissed.has(j.id)).slice(0, MAX_VISIBLE);
  if (visible.length === 0) return null;

  const hide = async (job) => {
    setDismissed((prev) => new Set([...prev, job.id]));
    if (job.status !== 'pending' && job.status !== 'running') {
      try { await dismissCopyJob(job.id); } catch (e) { /* the row expires on its own anyway */ }
    }
  };

  return (
    <div className="copy-jobs-banner" role="status" aria-live="polite">
      {visible.map((job) => {
        const running = job.status === 'running';
        const pending = job.status === 'pending';
        const failed = job.status === 'failed';
        return (
          <div key={job.id} className={`copy-job-row ${job.status}`}>
            <span className="copy-job-icon">
              {failed ? <AlertCircle size={14} color="var(--accent-rose)" />
                : job.status === 'done' ? <Check size={14} color="var(--accent-emerald)" />
                : <Loader2 size={14} className="spin" color="var(--accent-primary)" />}
            </span>
            <div className="copy-job-main">
              <div className="copy-job-title">
                <Copy size={12} />
                <span className="copy-job-name" title={job.summary}>{job.summary}</span>
                <span className="copy-job-state">
                  {pending ? '대기 중'
                    : running ? `${job.copied_files}/${job.total_files}`
                    : failed ? '실패'
                    : job.is_move ? '이동 완료' : '복사 완료'}
                </span>
              </div>
              {(running || pending) && (
                <div className="copy-job-bar">
                  <div className="copy-job-bar-fill" style={{ width: `${pct(job)}%` }} />
                </div>
              )}
              {failed && job.error_message && (
                <div className="copy-job-error" title={job.error_message}>{job.error_message}</div>
              )}
            </div>
            {/* Only finished jobs can be cleared away — hiding a running one
                would suggest it had been cancelled, which it has not. */}
            {!running && !pending && (
              <button type="button" className="copy-job-close" onClick={() => hide(job)} title="지우기">
                <X size={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
