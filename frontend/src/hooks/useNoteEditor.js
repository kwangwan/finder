import { useState, useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { ko as blockNoteKo } from '@blocknote/core/locales';
import { Extension } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';
import {
  uploadNoteImage,
  ensureMediaToken,
  getMediaPreviewUrl,
  getStoredToken,
  getAuthConfig,
  checkpointFileVersion,
  updateMarkdownNote
} from '../api';
import { getVideoEmbedUrl, VIDEO_EMBED_LINK_TEXT } from '../utils/markdownLinkComponents';
import { exportMarkdownToPdf } from '../utils/pdfExport';
import { useDialog } from '../context/DialogContext';

const COLLAB_FRAGMENT_NAME = 'blocknote';

// See the original NoteEditor.jsx history for the full derivation of these
// two timers — kept identical when this logic was ported into a reusable
// hook so any open note window (there can now be several at once) still
// gets Notion-style session-boundary + periodic history checkpoints.
const IDLE_CHECKPOINT_DELAY = 2 * 60 * 1000;
const PERIODIC_CHECKPOINT_INTERVAL = 10 * 60 * 1000;

// Once the bounded retry below (2 attempts, ~15s total) gives up, nothing
// else used to retry a failed autosave until the user's next real edit —
// leaving "저장 실패" shown indefinitely if the outage (backend redeploy,
// network blip, DB hiccup) outlasts that window, even long after the
// backend actually recovers. Keep trying quietly in the background at this
// cadence until a save finally succeeds.
const BACKGROUND_SAVE_RETRY_INTERVAL = 30 * 1000;

const BN_THEME = {
  colors: {
    editor: { text: 'var(--text-primary)', background: 'var(--bg-primary)' },
    menu: { text: 'var(--text-primary)', background: 'var(--bg-secondary)' },
    tooltip: { text: 'var(--text-primary)', background: 'var(--bg-tertiary)' },
    hovered: { text: 'var(--text-primary)', background: 'var(--bg-tertiary)' },
    selected: { text: '#ffffff', background: 'var(--accent-primary)' },
    disabled: { text: 'var(--text-muted)', background: 'var(--bg-tertiary)' },
    shadow: 'var(--border-subtle)',
    border: 'var(--border-subtle)',
    sideMenu: 'var(--text-muted)'
  },
  borderRadius: 8,
  fontFamily: 'var(--font-sans)'
};

export { BN_THEME };

const stockVideoSpec = defaultBlockSpecs.video;

function renderVideoBlock(block, editor) {
  const embedUrl = getVideoEmbedUrl(block.props.url);
  if (!embedUrl) return stockVideoSpec.implementation.render.call(this, block, editor);

  const wrapper = document.createElement('div');
  wrapper.contentEditable = 'false';
  wrapper.style.position = 'relative';
  wrapper.style.paddingBottom = '56.25%';
  wrapper.style.height = '0';
  wrapper.style.overflow = 'hidden';
  wrapper.style.borderRadius = 'var(--radius-lg)';
  wrapper.style.margin = '0.4rem 0';

  const iframe = document.createElement('iframe');
  iframe.src = embedUrl;
  iframe.title = 'Video Player';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.style.position = 'absolute';
  iframe.style.top = '0';
  iframe.style.left = '0';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  wrapper.appendChild(iframe);
  return { dom: wrapper };
}

function videoBlockToExternalHTML(block, editor, context) {
  const embedUrl = getVideoEmbedUrl(block.props.url);
  if (!embedUrl) return stockVideoSpec.implementation.toExternalHTML.call(this, block, editor, context);
  const a = document.createElement('a');
  a.href = block.props.url;
  a.textContent = VIDEO_EMBED_LINK_TEXT;
  return { dom: a };
}

function upgradeVideoLinks(blocks) {
  return blocks.map((block) => {
    const children = block.children?.length ? upgradeVideoLinks(block.children) : block.children;
    if (block.type === 'paragraph' && block.content?.length === 1) {
      const node = block.content[0];
      if (node?.type === 'link' && node.content?.[0]?.text === VIDEO_EMBED_LINK_TEXT) {
        return { type: 'video', props: { url: node.href }, children };
      }
    }
    return children === block.children ? block : { ...block, children };
  });
}

const blockNoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    video: {
      ...stockVideoSpec,
      implementation: {
        ...stockVideoSpec.implementation,
        render: renderVideoBlock,
        toExternalHTML: videoBlockToExternalHTML
      }
    }
  }
});

let syncUrlPromise = null;
function getSyncUrl() {
  if (!syncUrlPromise) {
    syncUrlPromise = getAuthConfig()
      .then((cfg) => cfg.sync_url || 'ws://localhost:1234')
      .catch(() => 'ws://localhost:1234');
  }
  return syncUrlPromise;
}

const IMAGE_MARKDOWN_RE = /(!\[[^\]]*\]\()(\/api\/storage\/preview\/[^)?]+)(\?[^)]*)?(\))/g;
const IMAGE_ID_RE = /\/api\/storage\/preview\/([^/?]+)/;

async function refreshImageTokensInMarkdown(markdown) {
  if (!markdown || !markdown.includes('/api/storage/preview/')) return markdown;
  await ensureMediaToken();
  return markdown.replace(IMAGE_MARKDOWN_RE, (match, pre, path, _query, post) => {
    const idMatch = path.match(IMAGE_ID_RE);
    if (!idMatch) return match;
    return pre + getMediaPreviewUrl(idMatch[1]) + post;
  });
}

function collectImageBlocks(blocks, acc = []) {
  for (const block of blocks) {
    if (block.type === 'image' && block.props?.url) acc.push(block);
    if (block.children && block.children.length) collectImageBlocks(block.children, acc);
  }
  return acc;
}

function colorForUser(id) {
  const str = String(id || 'anonymous');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 55%)`;
}

// WORKAROUND for a confirmed real Android bug — see NoteEditor.jsx's git
// history (commits around 687d50a) for the full investigation. Kept
// unchanged when this was ported into a reusable hook.
function createAndroidBeforeInputEnterFix() {
  return Extension.create({
    name: 'finderAndroidBeforeInputEnterFix',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              beforeinput(view, event) {
                if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') return false;
                event.preventDefault();
                const fakeEvent = document.createEvent('Event');
                fakeEvent.initEvent('keydown', true, true);
                fakeEvent.keyCode = 13;
                fakeEvent.key = fakeEvent.code = 'Enter';
                fakeEvent.shiftKey = event.inputType === 'insertLineBreak';
                view.someProp('handleKeyDown', (f) => f(view, fakeEvent));
                return true;
              }
            }
          }
        })
      ];
    }
  });
}

// GFM markdown table syntax has no way to represent a literal newline inside
// a cell (one row = one line) — a soft line break (Shift+Enter, or an
// Android keyboard's beforeinput insertLineBreak) typed into a table cell
// exports as a hard-break escape followed by a real "\n", which then
// re-parses as an extra, misaligned table row the next time the note is
// reopened (Hocuspocus re-seeds from the stored markdown once its last
// client disconnects — see the Yjs-room-unload note elsewhere in this
// codebase). Block it at the source instead of trying to encode/decode it
// losslessly through markdown.
function createTableCellNoLineBreakFix() {
  const insideTableCell = (state) => {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const typeName = $from.node(d).type.name;
      if (typeName === 'tableCell' || typeName === 'tableHeader') return true;
    }
    return false;
  };

  return Extension.create({
    name: 'finderTableCellNoLineBreak',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              if (event.key !== 'Enter' || !event.shiftKey) return false;
              if (!insideTableCell(view.state)) return false;
              event.preventDefault();
              return true;
            },
            handleDOMEvents: {
              beforeinput(view, event) {
                if (event.inputType !== 'insertLineBreak') return false;
                if (!insideTableCell(view.state)) return false;
                event.preventDefault();
                return true;
              }
            }
          }
        })
      ];
    }
  });
}

/**
 * Owns everything a collaborative BlockNote note editor needs: the Yjs
 * doc/Hocuspocus room, the BlockNote editor instance, autosave + version-
 * history checkpoint timers, and image/video markdown round-trip fixups.
 *
 * Extracted from the old full-page NoteEditor.jsx so it can be mounted once
 * per open note *window* instead of once per whole app — every piece of
 * state here is already component-instance-local (keyed off `file.id`), so
 * multiple different notes can each get their own instance safely at once;
 * `useWindowManager`'s `openWindow` also already refuses to open a second
 * window for the same file id, so two instances can never fight over the
 * same Yjs room.
 */
export function useNoteEditor({ file, activeWorkspaceId, currentUser, enabled, onFileUpdated }) {
  const { showAlert } = useDialog();
  const [title, setTitle] = useState(file?.name || '제목 없는 문서');
  const [tags, setTags] = useState(file?.tags || []);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [saveError, setSaveError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [syncUrl, setSyncUrl] = useState(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isAttachModalOpen, setIsAttachModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isContentLoading, setIsContentLoading] = useState(true);

  const saveTimeoutRef = useRef(null);
  const saveRetryTimeoutRef = useRef(null);
  const saveRetryIntervalRef = useRef(null);
  const saveRetryCountRef = useRef(0);
  const idleCheckpointTimeoutRef = useRef(null);
  const fileRef = useRef(file);
  const workspaceIdRef = useRef(activeWorkspaceId);
  const titleRef = useRef(title);
  const tagsRef = useRef(tags);
  const saveStatusRef = useRef(saveStatus);
  const onFileUpdatedRef = useRef(onFileUpdated);
  const isLoadingContentRef = useRef(true);
  const hasBootstrappedRef = useRef(false);
  const editorRef = useRef(null);

  fileRef.current = file;
  workspaceIdRef.current = activeWorkspaceId;
  titleRef.current = title;
  tagsRef.current = tags;
  saveStatusRef.current = saveStatus;
  onFileUpdatedRef.current = onFileUpdated;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getSyncUrl().then((url) => { if (!cancelled) setSyncUrl(url); });
    return () => { cancelled = true; };
  }, [enabled]);

  const [collab, setCollab] = useState(null);

  const doSave = useCallback(async (newTitle, newTags) => {
    setSaveStatus('saving');
    try {
      const markdown = editorRef.current.blocksToMarkdownLossy(editorRef.current.document);
      const updated = await updateMarkdownNote(fileRef.current.id, { name: newTitle, content: markdown, tags: newTags });
      setSaveStatus('saved');
      setSaveError(null);
      saveRetryCountRef.current = 0;
      if (saveRetryIntervalRef.current) {
        clearInterval(saveRetryIntervalRef.current);
        saveRetryIntervalRef.current = null;
      }
      onFileUpdatedRef.current?.(updated);
    } catch (err) {
      const message = err?.message || '알 수 없는 오류';
      setSaveStatus('unsaved');
      setSaveError(message);
      console.error('Auto-save error:', err);
      if (saveRetryCountRef.current < 2) {
        saveRetryCountRef.current += 1;
        if (saveRetryTimeoutRef.current) clearTimeout(saveRetryTimeoutRef.current);
        saveRetryTimeoutRef.current = setTimeout(() => {
          saveRetryTimeoutRef.current = null;
          doSave(newTitle, newTags);
        }, saveRetryCountRef.current * 5000);
      } else if (!saveRetryIntervalRef.current) {
        saveRetryIntervalRef.current = setInterval(() => {
          doSave(titleRef.current, tagsRef.current);
        }, BACKGROUND_SAVE_RETRY_INTERVAL);
      }
    }
  }, []);

  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  const isSaveLeader = useCallback(() => {
    if (!collab?.provider?.awareness) return true;
    const ids = Array.from(collab.provider.awareness.getStates().keys());
    if (ids.length === 0) return true;
    return collab.ydoc.clientID === Math.min(...ids);
  }, [collab]);

  const isSaveLeaderRef = useRef(isSaveLeader);
  isSaveLeaderRef.current = isSaveLeader;

  useEffect(() => {
    if (!enabled || !file?.id || !syncUrl) {
      setCollab(null);
      return;
    }
    hasBootstrappedRef.current = false;
    isLoadingContentRef.current = true;
    setIsContentLoading(true);
    const newYdoc = new Y.Doc();
    const newProvider = new HocuspocusProvider({
      url: syncUrl,
      name: file.id,
      document: newYdoc,
      token: () => getStoredToken() || '',
      onAuthenticationFailed: () => setSyncStatus('error'),
      onSynced: async () => {
        setSyncStatus('connected');
        if (hasBootstrappedRef.current) return;
        hasBootstrappedRef.current = true;
        try {
          if (newYdoc.getXmlFragment(COLLAB_FRAGMENT_NAME).length === 0 && editorRef.current) {
            const processed = await refreshImageTokensInMarkdown(fileRef.current?.content || '');
            const blocks = upgradeVideoLinks(editorRef.current.tryParseMarkdownToBlocks(processed || ' '));
            editorRef.current.replaceBlocks(editorRef.current.document, blocks);
          }
        } finally {
          isLoadingContentRef.current = false;
          setIsContentLoading(false);
        }
      }
    });
    setCollab({ ydoc: newYdoc, provider: newProvider });
    return () => {
      if (idleCheckpointTimeoutRef.current) {
        clearTimeout(idleCheckpointTimeoutRef.current);
        idleCheckpointTimeoutRef.current = null;
      }
      if (saveRetryTimeoutRef.current) {
        clearTimeout(saveRetryTimeoutRef.current);
        saveRetryTimeoutRef.current = null;
      }
      if (saveRetryIntervalRef.current) {
        clearInterval(saveRetryIntervalRef.current);
        saveRetryIntervalRef.current = null;
      }
      // A note window can now be closed or minimized far more casually than
      // the old full-page editor's single "뒤로가기" button ever allowed
      // (PreviewWindow fully unmounts on both) — flush any edit still
      // sitting in the 1s autosave debounce instead of silently dropping it.
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        if (isSaveLeaderRef.current()) {
          doSaveRef.current(titleRef.current, tagsRef.current).catch(() => {});
        }
      }
      newProvider.destroy();
      newYdoc.destroy();
    };
  }, [enabled, file?.id, syncUrl]);

  const androidBeforeInputEnterFixRef = useRef(null);
  if (!androidBeforeInputEnterFixRef.current) androidBeforeInputEnterFixRef.current = createAndroidBeforeInputEnterFix();
  const tableCellNoLineBreakFixRef = useRef(null);
  if (!tableCellNoLineBreakFixRef.current) tableCellNoLineBreakFixRef.current = createTableCellNoLineBreakFix();

  const editor = useCreateBlockNote(
    collab
      ? withCollaboration({
          schema: blockNoteSchema,
          dictionary: blockNoteKo,
          _tiptapOptions: { extensions: [androidBeforeInputEnterFixRef.current, tableCellNoLineBreakFixRef.current] },
          uploadFile: async (uploadedFile) => {
            setIsUploadingImage(true);
            try {
              const res = await uploadNoteImage(uploadedFile, workspaceIdRef.current, fileRef.current?.folder_id);
              return res.previewUrl;
            } finally {
              setIsUploadingImage(false);
            }
          },
          collaboration: {
            fragment: collab.ydoc.getXmlFragment(COLLAB_FRAGMENT_NAME),
            user: {
              name: currentUser?.name || currentUser?.email?.split('@')[0] || '익명',
              color: colorForUser(currentUser?.id || currentUser?.email)
            },
            provider: { awareness: collab.provider.awareness }
          }
        })
      : { schema: blockNoteSchema, dictionary: blockNoteKo, _tiptapOptions: { extensions: [androidBeforeInputEnterFixRef.current, tableCellNoLineBreakFixRef.current] } },
    [file?.id, syncUrl, collab]
  );

  editorRef.current = editor;

  useEffect(() => {
    if (!file) return;
    setTitle(file.name);
    setTags(file.tags || []);
    setSaveStatus('saved');
    setSaveError(null);
    saveRetryCountRef.current = 0;
  }, [file?.id]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      const images = collectImageBlocks(editor.document).filter((b) => b.props.url.includes('/api/storage/preview/'));
      if (images.length === 0) return;
      await ensureMediaToken();
      images.forEach((b) => {
        const idMatch = b.props.url.match(IMAGE_ID_RE);
        if (idMatch) editor.updateBlock(b, { props: { url: getMediaPreviewUrl(idMatch[1]) } });
      });
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [editor, enabled]);

  const triggerAutoSave = useCallback((newTitle, newTags) => {
    setSaveStatus('unsaved');
    saveRetryCountRef.current = 0;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (saveRetryTimeoutRef.current) {
      clearTimeout(saveRetryTimeoutRef.current);
      saveRetryTimeoutRef.current = null;
    }
    if (saveRetryIntervalRef.current) {
      clearInterval(saveRetryIntervalRef.current);
      saveRetryIntervalRef.current = null;
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      if (!isSaveLeaderRef.current()) {
        setSaveStatus('saved');
        return;
      }
      doSave(newTitle, newTags);
    }, 1000);
  }, [doSave]);

  const scheduleIdleCheckpoint = useCallback(() => {
    if (idleCheckpointTimeoutRef.current) clearTimeout(idleCheckpointTimeoutRef.current);
    idleCheckpointTimeoutRef.current = setTimeout(() => {
      idleCheckpointTimeoutRef.current = null;
      if (!isSaveLeaderRef.current() || !fileRef.current?.id) return;
      checkpointFileVersion(fileRef.current.id).catch(() => {});
    }, IDLE_CHECKPOINT_DELAY);
  }, []);

  useEffect(() => {
    if (!enabled || !file?.id) return;
    const interval = setInterval(() => {
      if (!isSaveLeaderRef.current()) return;
      checkpointFileVersion(file.id).catch(() => {});
    }, PERIODIC_CHECKPOINT_INTERVAL);
    return () => clearInterval(interval);
  }, [enabled, file?.id]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (idleCheckpointTimeoutRef.current) {
        clearTimeout(idleCheckpointTimeoutRef.current);
        idleCheckpointTimeoutRef.current = null;
      }
      if (!isSaveLeaderRef.current()) return;
      const pending = saveStatusRef.current === 'saved' ? Promise.resolve() : doSaveRef.current(titleRef.current, tagsRef.current);
      Promise.resolve(pending).then(() => {
        if (fileRef.current?.id) checkpointFileVersion(fileRef.current.id).catch(() => {});
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled]);

  const handleTitleChange = (e) => {
    const val = e.target.value;
    setTitle(val);
    triggerAutoSave(val, tags);
    scheduleIdleCheckpoint();
  };

  const handleEditorChange = () => {
    if (isLoadingContentRef.current) return;
    triggerAutoSave(titleRef.current, tagsRef.current);
    scheduleIdleCheckpoint();
  };

  const handleInsertAttachedFile = (snippet) => {
    const blocks = editor.tryParseMarkdownToBlocks(snippet);
    const cursor = editor.getTextCursorPosition();
    editor.insertBlocks(blocks, cursor.block, 'after');
    handleEditorChange();
  };

  const handleVersionRestored = async (updatedFile) => {
    const processed = await refreshImageTokensInMarkdown(updatedFile.content || '');
    const blocks = upgradeVideoLinks(editor.tryParseMarkdownToBlocks(processed || ' '));
    editor.replaceBlocks(editor.document, blocks);
    onFileUpdatedRef.current?.(updatedFile);
  };

  const handleExportMarkdown = () => {
    const markdown = editor.blocksToMarkdownLossy(editor.document);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title.endsWith('.md') ? title : `${title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const markdown = editor.blocksToMarkdownLossy(editor.document);
      await exportMarkdownToPdf(title, markdown);
    } catch (err) {
      await showAlert({
        title: 'PDF 내보내기 실패',
        message: 'PDF를 생성하는 중 오류가 발생했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  return {
    editor,
    title,
    handleTitleChange,
    handleEditorChange,
    saveStatus,
    saveError,
    syncStatus,
    isUploadingImage,
    isExportingPdf,
    isContentLoading,
    isAttachModalOpen,
    setIsAttachModalOpen,
    isHistoryModalOpen,
    setIsHistoryModalOpen,
    handleInsertAttachedFile,
    handleVersionRestored,
    handleExportMarkdown,
    handleExportPdf
  };
}
