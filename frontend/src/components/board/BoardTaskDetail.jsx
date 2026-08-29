import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { ko as blockNoteKo } from '@blocknote/core/locales';
import '@blocknote/mantine/style.css';

import { X, Loader2, Paperclip, Check } from '../../utils/icons';
import {
  getBoardTask,
  updateBoardTask,
  uploadNoteImage,
} from '../../api';
import {
  BN_THEME,
  blocksToMarkdownTableSafe,
  expandBlankParagraphs,
  restoreBlankParagraphs,
} from '../../hooks/useNoteEditor';
import { useDialog } from '../../context/DialogContext';
import { PRIORITIES, STATUSES, fullStamp } from './BoardPane';

const SAVE_DEBOUNCE_MS = 900;

/**
 * One task, opened for editing.
 *
 * The notes use the same editor and the same markdown as a document, so what
 * is written here reads and round-trips identically — including the blank-line
 * and table handling the document editor already had to solve.
 *
 * Deliberately *not* collaborative. A document is a thing several people write
 * together; a task's notes are a field on a row, and standing up a sync
 * session per row would open one socket per task opened.
 */
export default function BoardTaskDetail({ file, task, canWrite, assignableUsers = [], onClose, onSaved }) {
  const { showAlert } = useDialog();
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [isAttaching, setIsAttaching] = useState(false);
  const [name, setName] = useState(task.name);
  const saveTimer = useRef(null);
  const attachRef = useRef(null);
  const latestRef = useRef({ taskId: task.id });

  const editor = useCreateBlockNote({
    dictionary: blockNoteKo,
    // An attachment belongs with the rest of the folder's material, not in a
    // store of its own — that is what makes it findable later by someone who
    // never opens this board.
    uploadFile: async (picked) => {
      setIsAttaching(true);
      try {
        const res = await uploadNoteImage(picked, file.workspace_id || null, file.folder_id || null);
        return res.previewUrl;
      } finally {
        setIsAttaching(false);
      }
    },
  }, [task.id]);

  // Load the notes for whichever task is open.
  useEffect(() => {
    let cancelled = false;
    setDetailLoaded(false);
    setName(task.name);
    latestRef.current = { taskId: task.id };
    (async () => {
      try {
        const full = await getBoardTask(file.id, task.id);
        if (cancelled) return;
        const markdown = full.detail || '';
        const blocks = markdown.trim()
          ? restoreBlankParagraphs(editor.tryParseMarkdownToBlocks(expandBlankParagraphs(markdown)))
          : [{ type: 'paragraph', content: [] }];
        editor.replaceBlocks(editor.document, blocks);
      } catch (e) {
        if (!cancelled) await showAlert({ title: '불러오지 못했습니다', message: e.message, type: 'error' });
      } finally {
        if (!cancelled) setDetailLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, task.id, editor]);

  const save = useCallback(async (payload) => {
    setSaveState('saving');
    try {
      const updated = await updateBoardTask(file.id, task.id, payload);
      setSaveState('saved');
      onSaved?.(updated);
    } catch (e) {
      setSaveState('error');
      await showAlert({ title: '저장하지 못했습니다', message: e.message, type: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, task.id, onSaved]);

  const queueDetailSave = useCallback(() => {
    if (!canWrite || !detailLoaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const markdown = blocksToMarkdownTableSafe(editor, editor.document);
      save({ detail: markdown });
    }, SAVE_DEBOUNCE_MS);
  }, [canWrite, detailLoaded, editor, save]);

  // A pending edit must not be lost by closing the panel — the debounce is a
  // convenience, not permission to drop the last thing typed.
  useEffect(() => () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    const markdown = blocksToMarkdownTableSafe(editor, editor.document);
    updateBoardTask(file.id, latestRef.current.taskId, { detail: markdown }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === task.name) { setName(task.name); return; }
    save({ name: trimmed });
  };

  const toggleAssignee = (userId) => {
    const current = task.assignees.map((a) => a.id);
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    save({ assignee_ids: next });
  };

  return (
    <div className="board-detail">
      <div className="board-detail-head">
        <input
          className="board-detail-title"
          value={name}
          disabled={!canWrite}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); setName(task.name); e.target.blur(); }
          }}
        />
        <span className="board-detail-state">
          {saveState === 'saving' && <><Loader2 size={12} className="spin" /> 저장 중</>}
          {saveState === 'saved' && <><Check size={12} /> 저장됨</>}
          {saveState === 'error' && <span className="board-detail-error">저장 실패</span>}
        </span>
        <button type="button" className="btn-icon" onClick={onClose} title="닫기"><X size={15} /></button>
      </div>

      <div className="board-detail-fields">
        <label>
          <span>중요도</span>
          <select
            className={`board-chip priority-${task.priority}`}
            value={task.priority}
            disabled={!canWrite}
            onChange={(e) => save({ priority: e.target.value })}
          >
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label>
          <span>진행 상태</span>
          <select
            className={`board-chip status-${task.status}`}
            value={task.status}
            disabled={!canWrite}
            onChange={(e) => save({ status: e.target.value })}
          >
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>
          <span>기간</span>
          <span className="board-detail-period">
            <input
              type="date"
              value={task.start_date || ''}
              disabled={!canWrite}
              aria-label="시작일"
              onChange={(e) => save({ start_date: e.target.value || null })}
            />
            <span className="board-period-dash">–</span>
            <input
              type="date"
              value={task.due_date || ''}
              disabled={!canWrite}
              aria-label="종료일"
              onChange={(e) => save({ due_date: e.target.value || null })}
            />
          </span>
        </label>
      </div>

      {/* Read, never set — so they sit apart from the fields above rather than
          looking like two more things to fill in. */}
      <div className="board-detail-stamps">
        <span>만든 날 {fullStamp(task.created_at)}{task.created_by_name ? ` · ${task.created_by_name}` : ''}</span>
        <span>마지막 수정 {fullStamp(task.updated_at)}{task.last_edited_by_name ? ` · ${task.last_edited_by_name}` : ''}</span>
      </div>

      <div className="board-detail-people">
        <span className="board-detail-label">작업자</span>
        <div className="board-people-list">
          {assignableUsers.length === 0 && <span className="board-muted">지정할 수 있는 사람이 없습니다.</span>}
          {assignableUsers.map((u) => {
            const on = task.assignees.some((a) => a.id === u.id);
            return (
              <button
                key={u.id}
                type="button"
                className={`board-person-toggle ${on ? 'on' : ''}`}
                disabled={!canWrite}
                onClick={() => toggleAssignee(u.id)}
              >
                {on && <Check size={11} />}
                <span>{u.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="board-detail-notes">
        <div className="board-detail-label-row">
          <span className="board-detail-label">상세 내용</span>
          <button
            type="button"
            className="btn-secondary board-attach-btn"
            disabled={!canWrite || isAttaching}
            onClick={() => attachRef.current?.click()}
            title="이 일정이 있는 폴더에 저장됩니다"
          >
            {isAttaching ? <Loader2 size={12} className="spin" /> : <Paperclip size={12} />}
            <span>파일 첨부</span>
          </button>
          <input
            ref={attachRef}
            type="file"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (!picked) return;
              setIsAttaching(true);
              try {
                const res = await uploadNoteImage(picked, file.workspace_id || null, file.folder_id || null);
                const isImage = (res.file_type || '').toLowerCase() === 'image';
                editor.insertBlocks(
                  [isImage
                    ? { type: 'image', props: { url: res.previewUrl, name: picked.name } }
                    : {
                      type: 'paragraph',
                      content: [{ type: 'link', href: res.previewUrl, content: picked.name }],
                    }],
                  editor.document[editor.document.length - 1],
                  'after',
                );
                queueDetailSave();
              } catch (err) {
                await showAlert({ title: '첨부하지 못했습니다', message: err.message, type: 'error' });
              } finally {
                setIsAttaching(false);
              }
            }}
          />
        </div>
        {!detailLoaded ? (
          <div className="board-empty"><Loader2 size={16} className="spin" /><span>불러오는 중...</span></div>
        ) : (
          <div className="board-editor">
            <BlockNoteView editor={editor} editable={canWrite} theme={BN_THEME} onChange={queueDetailSave} />
          </div>
        )}
      </div>
    </div>
  );
}
