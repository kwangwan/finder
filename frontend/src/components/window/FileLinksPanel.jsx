import React, { useCallback, useEffect, useState } from 'react';
import {
  Paperclip, FileText, Calendar, Trash2, AlertTriangle, ChevronDown, ChevronRight,
} from '../../utils/icons';
import { getFileLinks } from '../../api';

/**
 * One read of what a file is joined to, shared by everything that shows it.
 *
 * The window decorates its own body with it (an attachment that is gone gets
 * said so where it used to be) and the strip lists it, so both cannot end up
 * describing different states of the same document.
 */
export function useFileLinks(fileId, refreshToken = 0) {
  const [links, setLinks] = useState(null);

  const load = useCallback(() => {
    if (!fileId) { setLinks(null); return; }
    getFileLinks(fileId).then(setLinks).catch(() => setLinks(null));
  }, [fileId]);

  useEffect(() => { load(); }, [load, refreshToken]);
  return links;
}

const STATE_LABEL = {
  ok: null,
  trashed: '휴지통에 있음',
  deleted: '삭제됨',
};

/**
 * What this file is joined to, said out loud.
 *
 * Attachments used to exist only as a URL buried in a document's markdown:
 * nothing could say what a file was used by, and deleting one left a silent
 * blank where a picture had been. This strip is the other half of that —
 * every connection is listed, every entry opens what it names in a window of
 * its own, and an attachment that is gone says so instead of disappearing.
 */
export default function FileLinksPanel({ links, isDocument, onOpenFile }) {
  const [open, setOpen] = useState(true);

  if (!links) return null;

  const attachments = links.attachments || [];
  const attachedTo = links.attached_to || [];
  const task = links.board_task;
  const brokenCount = attachments.filter((a) => a.state !== 'ok').length;

  if (!task && attachments.length === 0 && attachedTo.length === 0) return null;

  const openFile = (row) => {
    if (!row?.id || row.state === 'deleted') return;
    onOpenFile?.({
      id: row.id,
      name: row.name,
      file_type: row.file_type,
      is_markdown: row.is_markdown,
      folder_id: row.folder_id,
      workspace_id: row.workspace_id,
    });
  };

  return (
    <div className={`fl-panel ${open ? '' : 'is-closed'}`}>
      <button type="button" className="fl-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>연결</span>
        {brokenCount > 0 && (
          <span className="fl-warn-count" title="삭제되었거나 휴지통에 있는 첨부 파일">
            <AlertTriangle size={11} />{brokenCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fl-body">
          {task && (
            <div className="fl-group">
              <span className="fl-label"><Calendar size={11} />일정</span>
              <button
                type="button"
                className="fl-chip is-board"
                title="이 할 일이 있는 일정 열기"
                onClick={() => onOpenFile?.({
                  id: task.board_id,
                  name: task.board_name,
                  file_type: 'board',
                  is_markdown: false,
                  folder_id: task.board_folder_id,
                  workspace_id: task.board_workspace_id,
                })}
              >
                <Calendar size={11} />
                <span>{task.board_name || '일정'}</span>
                <span className="fl-chip-sub">{task.task_name}</span>
              </button>
              <span className="fl-note">이 문서는 할 일에 연결되어 있어 일정에서만 삭제할 수 있습니다.</span>
            </div>
          )}

          {isDocument && attachments.length > 0 && (
            <div className="fl-group">
              <span className="fl-label"><Paperclip size={11} />첨부 파일 {attachments.length}</span>
              {attachments.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`fl-chip state-${row.state}`}
                  disabled={row.state === 'deleted'}
                  onClick={() => openFile(row)}
                  title={row.state === 'ok' ? '새 창에서 열기'
                    : row.state === 'trashed' ? '휴지통에 있습니다. 복구하면 다시 표시됩니다.'
                      : '삭제된 파일입니다.'}
                >
                  {row.state === 'ok' ? <FileText size={11} /> : <Trash2 size={11} />}
                  <span>{row.name || '삭제된 파일'}</span>
                  {STATE_LABEL[row.state] && <span className="fl-chip-state">{STATE_LABEL[row.state]}</span>}
                </button>
              ))}
            </div>
          )}

          {attachedTo.length > 0 && (
            <div className="fl-group">
              <span className="fl-label"><FileText size={11} />첨부된 문서 {attachedTo.length}</span>
              {attachedTo.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`fl-chip ${row.is_trashed ? 'state-trashed' : ''}`}
                  onClick={() => openFile(row)}
                  title="이 문서를 새 창에서 열기"
                >
                  <FileText size={11} />
                  <span>{row.name}</span>
                  {row.is_trashed && <span className="fl-chip-state">휴지통</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
