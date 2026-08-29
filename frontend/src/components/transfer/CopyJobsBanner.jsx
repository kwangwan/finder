import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, X, Check, AlertCircle, Loader2, Ban } from '../../utils/icons';
import { listCopyJobs, dismissCopyJob, cancelCopyJob } from '../../api';

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

// Asked for once, the first time a job is actually queued — never on load,
// which would be a permission prompt out of nowhere.
function requestNotifyPermission() {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch (e) { /* unsupported or blocked; the banner still works */ }
}

function notify(job) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const done = job.status === 'done';
    const title = done
      ? `${job.is_move ? '이동' : '복사'}이 완료되었습니다`
      : job.status === 'cancelled' ? '작업이 취소되었습니다' : '작업이 실패했습니다';
    new Notification(title, {
      body: `${job.summary} · 파일 ${job.copied_files}개`,
      tag: `copy-job-${job.id}`,
    });
  } catch (e) { /* never let a notification break the poll */ }
}

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
export default function CopyJobsBanner({ onJobsFinished, notifyPermissionTrigger = 0 }) {
  const [jobs, setJobs] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const activeIdsRef = useRef(new Set());
  const retireTimersRef = useRef(new Map());

  // Held in a ref so `poll` never changes identity. As a dependency it made
  // the polling effect tear down and re-arm on every render of the app — and
  // the effect opens by polling, so a burst of renders (which is what start-up
  // is) turned into a burst of requests that had nothing to do with the
  // interval: 11 in the first three seconds.
  const onJobsFinishedRef = useRef(onJobsFinished);
  useEffect(() => { onJobsFinishedRef.current = onJobsFinished; }, [onJobsFinished]);

  const poll = useCallback(async () => {
    try {
      const res = await listCopyJobs();
      const list = res.jobs || [];
      setJobs(list);

      // Tell the app when work actually finished, so the file list and any
      // open folder windows reload — the copies landed on the server without
      // this client doing anything.
      const nowActive = new Set(
        list.filter((j) => ['pending', 'running', 'cancelling'].includes(j.status)).map((j) => j.id)
      );
      const finished = [...activeIdsRef.current].filter((id) => !nowActive.has(id));
      activeIdsRef.current = nowActive;
      if (finished.length) {
        onJobsFinishedRef.current?.();
        // These run on the server and can outlast the page being looked at, so
        // a completion is worth surfacing outside the tab. Only when the tab
        // is actually hidden — a notification for something already on screen
        // is noise — and only with permission the user granted themselves.
        if (document.visibilityState !== 'visible') {
          finished.forEach((id) => {
            const job = list.find((j) => j.id === id);
            if (!job) return;
            notify(job);
          });
        }
      }
    } catch (e) { /* best-effort: a failed poll just retries */ }
  }, []);

  // Retire finished rows on a timer rather than on the next poll, so one that
  // completes while the queue is idle still goes away promptly.
  useEffect(() => {
    const timers = retireTimersRef.current;
    jobs.forEach((job) => {
      const finished = ['done', 'failed', 'cancelled'].includes(job.status);
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

  // Ask only once something has actually been queued.
  useEffect(() => {
    if (notifyPermissionTrigger > 0) requestNotifyPermission();
  }, [notifyPermissionTrigger]);

  useEffect(() => {
    let timer = null;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      clearTimeout(timer);
      const active = activeIdsRef.current.size > 0;
      timer = setTimeout(tick, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    const tick = async () => {
      // A hidden tab stops asking entirely rather than waking to do nothing;
      // it catches up the moment it is looked at again.
      if (document.visibilityState === 'visible') await poll();
      else return;
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      tick();
    };

    poll().then(schedule);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  const visible = jobs.filter((j) => !dismissed.has(j.id)).slice(0, MAX_VISIBLE);
  if (visible.length === 0) return null;

  const cancel = async (job) => {
    try {
      await cancelCopyJob(job.id);
      await poll();
    } catch (e) { /* it likely finished between render and click */ }
  };

  const hide = async (job) => {
    setDismissed((prev) => new Set([...prev, job.id]));
    if (!['pending', 'running', 'cancelling'].includes(job.status)) {
      try { await dismissCopyJob(job.id); } catch (e) { /* the row expires on its own anyway */ }
    }
  };

  return (
    <div className="copy-jobs-banner" role="status" aria-live="polite">
      {visible.map((job) => {
        const running = job.status === 'running';
        const pending = job.status === 'pending';
        const failed = job.status === 'failed';
        const cancelling = job.status === 'cancelling';
        const cancelled = job.status === 'cancelled';
        const active = running || pending || cancelling;
        return (
          <div key={job.id} className={`copy-job-row ${job.status}`}>
            <span className="copy-job-icon">
              {failed ? <AlertCircle size={14} color="var(--accent-rose)" />
                : cancelled ? <Ban size={14} color="var(--text-muted)" />
                : job.status === 'done' ? <Check size={14} color="var(--accent-emerald)" />
                : <Loader2 size={14} className="spin" color="var(--accent-primary)" />}
            </span>
            <div className="copy-job-main">
              <div className="copy-job-title">
                <Copy size={12} />
                <span className="copy-job-name" title={job.summary}>{job.summary}</span>
                <span className="copy-job-state">
                  {pending ? '대기 중'
                    : cancelling ? '취소하는 중'
                    : running ? `${job.copied_files}/${job.total_files}`
                    : failed ? '실패'
                    : cancelled ? `취소됨 · ${job.copied_files}개 완료`
                    : job.is_move ? '이동 완료' : '복사 완료'}
                </span>
              </div>
              {active && (
                <div className="copy-job-bar">
                  <div className="copy-job-bar-fill" style={{ width: `${pct(job)}%` }} />
                </div>
              )}
              {failed && job.error_message && (
                <div className="copy-job-error" title={job.error_message}>{job.error_message}</div>
              )}
            </div>
            {/* A running job offers cancel; a finished one offers dismiss.
                Hiding a running job would read as cancelling it, which it is
                not — so that button is never the one shown. */}
            {running || pending ? (
              <button type="button" className="copy-job-close" onClick={() => cancel(job)} title="작업 취소">
                <Ban size={13} />
              </button>
            ) : cancelling ? null : (
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
