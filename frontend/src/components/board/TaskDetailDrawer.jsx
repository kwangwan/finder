import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { ko as blockNoteKo } from '@blocknote/core/locales';
import '@blocknote/mantine/style.css';

import { X, Loader2, Paperclip, Check, Calendar } from '../../utils/icons';
import { getBoardTask, updateBoardTask, uploadNoteImage } from '../../api';
import {
  BN_THEME, blocksToMarkdownTableSafe, expandBlankParagraphs, restoreBlankParagraphs,
} from '../../hooks/useNoteEditor';
import { useDialog } from '../../context/DialogContext';
import { PRIORITIES, STATUSES, PillSelect, Avatar, fullStamp } from './TaskRow';

const SAVE_DEBOUNCE_MS = 900;

/**
 * One task, opened for editing.
 *
 * A drawer over the board rather than a strip pinned under it: the notes are
 * the reason to open a task at all, and the earlier version gave them the
 * bottom quarter of a window — so on any ordinary screen the editor was below
 * the fold and the feature looked missing. Here it gets the room, and the
 * board stays visible behind it so it is obvious what is being edited.
 */
export default function TaskDetailDrawer({ boardFile, task, canWrite, assignableUsers = [], onClose, onSaved }) {
  const { showAlert } = useDialog();
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [isAttaching, setIsAttaching] = useState(false);
  const [name, setName] = useState(task.name);
  const saveTimer = useRef(null);
  const attachRef = useRef(null);
  const taskIdRef = useRef(task.id);

  const folderId = task.board?.folder_id ?? boardFile?.folder_id ?? null;
  const workspaceId = task.board?.workspace_id ?? boardFile?.workspace_id ?? null;
  const fileId = task.file_id || boardFile?.id;

  const editor = useCreateBlockNote({
    dictionary: blockNoteKo,
    // An attachment belongs with the rest of the folder's material, not in a
    // store of its own — that is what makes it findable later by someone who
    // never opens this board.
    uploadFile: async (picked) => {
      setIsAttaching(true);
      try {
        const res = await uploadNoteImage(picked, workspaceId, folderId);
        return res.previewUrl;
      } finally {
        setIsAttaching(false);
      }
    },
  }, [task.id]);

  useEffect(() => {
    let cancelled = false;
    setDetailLoaded(false);
    setName(task.name);
    taskIdRef.current = task.id;
    (async () => {
      try {
        const full = await getBoardTask(fileId, task.id);
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
  }, [fileId, task.id, editor]);

  const save = useCallback(async (payload) => {
    setSaveState('saving');
    try {
      const updated = await updateBoardTask(fileId, task.id, payload);
      setSaveState('saved');
      onSaved?.(updated);
    } catch (e) {
      setSaveState('error');
      await showAlert({ title: '저장하지 못했습니다', message: e.message, type: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, task.id, onSaved]);

  const queueDetailSave = useCallback(() => {
    if (!canWrite || !detailLoaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      save({ detail: blocksToMarkdownTableSafe(editor, editor.document) });
    }, SAVE_DEBOUNCE_MS);
  }, [canWrite, detailLoaded, editor, save]);

  // A pending edit must not be lost by closing the drawer — the debounce is a
  // convenience, not permission to drop the last thing typed.
  useEffect(() => () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    updateBoardTask(fileId, taskIdRef.current, {
      detail: blocksToMarkdownTableSafe(editor, editor.document),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === task.name) { setName(task.name); return; }
    save({ name: trimmed });
  };

  const toggleAssignee = (userId) => {
    const current = task.assignees.map((a) => a.id);
    save({ assignee_ids: current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId] });
  };

  return (
    <div className="td-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="td-drawer" role="dialog" aria-label="작업 상세">
        <header className="td-head">
          <input
            className="td-title"
            value={name}
            disabled={!canWrite}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
              if (e.key === 'Escape') { e.preventDefault(); setName(task.name); e.target.blur(); }
            }}
            aria-label="작업 이름"
          />
          <span className="td-state">
            {saveState === 'saving' && <><Loader2 size={12} className="spin" /> 저장 중</>}
            {saveState === 'saved' && <><Check size={12} /> 저장됨</>}
            {saveState === 'error' && <span className="td-error">저장 실패</span>}
          </span>
          <button type="button" className="btn-icon" onClick={onClose} title="닫기 (Esc)"><X size={17} /></button>
        </header>

        {task.board?.name && (
          <div className="td-where">{task.board.name}</div>
        )}

        <div className="td-fields">
          <label>
            <span>진행 상태</span>
            <PillSelect
              kind="status" label="진행 상태" value={task.status} options={STATUSES}
              disabled={!canWrite} onChange={(v) => save({ status: v })}
            />
          </label>
          <label>
            <span>중요도</span>
            <PillSelect
              kind="priority" label="중요도" value={task.priority} options={PRIORITIES}
              disabled={!canWrite} onChange={(v) => save({ priority: v })}
            />
          </label>
          <label className="td-period-field">
            <span>기간</span>
            <span className="td-period">
              <Calendar size={12} />
              <input
                type="date" value={task.start_date || ''} max={task.due_date || undefined}
                disabled={!canWrite} aria-label="시작일"
                onChange={(e) => save({ start_date: e.target.value || null })}
              />
              <span className="bd-dash">–</span>
              <input
                type="date" value={task.due_date || ''} min={task.start_date || undefined}
                disabled={!canWrite} aria-label="종료일"
                onChange={(e) => save({ due_date: e.target.value || null })}
              />
            </span>
          </label>
        </div>

        <div className="td-people">
          <span className="td-label">작업자</span>
          <div className="td-people-list">
            {assignableUsers.length === 0 && <span className="board-muted">지정할 수 있는 사람이 없습니다.</span>}
            {assignableUsers.map((u) => {
              const on = task.assignees.some((a) => a.id === u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`td-person ${on ? 'on' : ''}`}
                  disabled={!canWrite}
                  onClick={() => toggleAssignee(u.id)}
                >
                  <Avatar person={u} size={20} />
                  <span>{u.name}</span>
                  {on && <Check size={11} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* The reason the drawer exists, so it gets the remaining height. */}
        <div className="td-notes">
          <div className="td-notes-head">
            <span className="td-label">상세 내용</span>
            <button
              type="button"
              className="btn-secondary td-attach"
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
                  const res = await uploadNoteImage(picked, workspaceId, folderId);
                  const isImage = (res.file_type || '').toLowerCase() === 'image';
                  editor.insertBlocks(
                    [isImage
                      ? { type: 'image', props: { url: res.previewUrl, name: picked.name } }
                      : { type: 'paragraph', content: [{ type: 'link', href: res.previewUrl, content: picked.name }] }],
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
            <div className="bd-empty"><Loader2 size={16} className="spin" /><span>불러오는 중...</span></div>
          ) : (
            <div className="td-editor">
              <BlockNoteView editor={editor} editable={canWrite} theme={BN_THEME} onChange={queueDetailSave} />
            </div>
          )}
        </div>

        <footer className="td-foot">
          <span>만든 날 {fullStamp(task.created_at)}{task.created_by_name ? ` · ${task.created_by_name}` : ''}</span>
          <span>마지막 수정 {fullStamp(task.updated_at)}{task.last_edited_by_name ? ` · ${task.last_edited_by_name}` : ''}</span>
        </footer>
      </aside>
    </div>
  );
}
