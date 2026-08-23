import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { withCollaboration } from '@blocknote/core/yjs';
import { ko as blockNoteKo } from '@blocknote/core/locales';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { Extension } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';
import {
  ArrowLeft,
  Download,
  FileText,
  Star,
  Trash2,
  Loader2,
  Paperclip,
  Clock
} from '../../utils/icons';
import AttachExistingFileModal from './AttachExistingFileModal';
import VersionHistoryModal from './VersionHistoryModal';
import { uploadNoteImage, ensureMediaToken, getMediaPreviewUrl, getStoredToken, getAuthConfig, checkpointFileVersion } from '../../api';
import { useDialog } from '../../context/DialogContext';
import { exportMarkdownToPdf } from '../../utils/pdfExport';
import { getVideoEmbedUrl, VIDEO_EMBED_LINK_TEXT } from '../../utils/markdownLinkComponents';

const COLLAB_FRAGMENT_NAME = 'blocknote';

// How long the editor waits after the last edit before treating the editing
// session as "closed" and forcing a version-history checkpoint of the
// current content. The backend rolls one open FileVersion row forward on
// every edit (see _roll_open_version in files.py) — this timer is what
// finalizes that row into a permanent history entry once the session
// actually ends, mirroring Notion's own session-end snapshot behavior.
const IDLE_CHECKPOINT_DELAY = 2 * 60 * 1000;

// A marathon editing session that never pauses for IDLE_CHECKPOINT_DELAY
// would otherwise never get a permanent history entry at all — the open row
// just keeps rolling forward in place forever. Force a checkpoint on this
// cadence too so continuous editing still gets a restore point periodically,
// matching the ~10-minute-while-actively-editing behavior described on the
// backend's checkpoint endpoint (which, before this, only actually happened
// via the idle/tab-hide paths below).
const PERIODIC_CHECKPOINT_INTERVAL = 10 * 60 * 1000;

// Maps BlockNote's own hardcoded light/dark greys onto this app's CSS
// variables instead, so the editor blends into whichever theme (dark/light/
// matrix) is active — including matrix's green-on-black palette, which the
// stock "dark" preset (a plain grey #1F1F1F) never would — rather than
// showing its own fixed grey box regardless of the app's theme. One object
// works for every theme since the values are var() references that already
// swap with the [data-theme] attribute; no light/dark split needed here.
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

// BlockNote's stock "video" block only understands a direct playable file
// URL — its render() does a literal `video.src = url` on an HTML5 <video>
// element. Pasting a YouTube/Vimeo watch-page URL into that block's own
// built-in "Embed link" tab sets that same raw src and silently fails to
// play, since a browser can't decode an HTML page as a video stream. This
// overrides just the block's render/toExternalHTML to recognize those two
// hosts and embed them as a responsive iframe, delegating to the original
// implementation for everything else (uploads, direct video file URLs) so
// upload/resize/caption behavior is untouched.
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
  // Export as a link, not the iframe — keeps the markdown stored in Postgres
  // (the RAG embedding pipeline's source of truth) and PDF export's existing
  // YouTube-thumbnail special-case working exactly as before. The link text
  // is deliberately NOT the bare URL: BlockNote's own markdown exporter
  // collapses a link to a bare URL whenever its text equals its href, and
  // strips any `title` attribute outright — so VIDEO_EMBED_LINK_TEXT is the
  // only signal that survives the round trip telling both the read-only
  // preview (markdownLinkComponents.jsx) and upgradeVideoLinks (below) "this
  // came from an actual video block" as opposed to a plain link someone just
  // typed.
  const a = document.createElement('a');
  a.href = block.props.url;
  a.textContent = VIDEO_EMBED_LINK_TEXT;
  return { dom: a };
}

// A collaborative doc's Yjs room isn't kept in the sync server's memory
// forever — Hocuspocus unloads a document once its last client disconnects,
// so simply closing a note and reopening it later (completely routine, not
// just a server restart) re-seeds the room from this markdown via
// tryParseMarkdownToBlocks. That parses a video block's exported link (see
// videoBlockToExternalHTML above) as an ordinary paragraph+link, degrading
// the embed to plain text every time — this is what upgrades it back. It
// only matches the exact VIDEO_EMBED_LINK_TEXT label, never a bare video URL
// or a link with different text, so a link the user actually typed/pasted
// still never gets turned into an embed (see markdownLinkComponents.jsx,
// which enforces the same rule for the read-only preview).
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

// The Vite build-time env var only bakes in on a plain `npm run build` — the
// Docker build context is `frontend/` alone, so it never sees the repo-root
// .env there, and would silently resolve to the fallback (pointing every
// deployed client at its OWN localhost instead of the real sync server).
// Fetch the real value from the backend at runtime instead (same pattern
// already used for the Google OAuth client id), cached module-wide since it
// never changes within a running session.
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

// Inserted images store `/api/storage/preview/{id}?token=...` with the token baked in
// at insert/load time, but it expires after 15 min (MEDIA_TOKEN_EXPIRE_MINUTES) — so any
// image URL sitting in stored markdown goes dead before the note is reopened. Refresh
// every embedded preview URL to a current token before handing markdown to the editor.
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

// A stable, deterministic color per user so the same person's cursor always
// looks the same across sessions/devices, without needing a server-assigned palette.
function colorForUser(id) {
  const str = String(id || 'anonymous');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 55%)`;
}

export default function NoteEditor({
  file,
  activeWorkspaceId,
  currentUser,
  onSave,
  onBack,
  onDelete,
  onToggleFavorite
}) {
  const { showAlert } = useDialog();
  const [title, setTitle] = useState(file?.name || '제목 없는 문서');
  const [tags, setTags] = useState(file?.tags || []);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [saveError, setSaveError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('connecting'); // 'connecting' | 'connected' | 'error'
  const [syncUrl, setSyncUrl] = useState(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isAttachModalOpen, setIsAttachModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  // Purely cosmetic mirror of isLoadingContentRef below, for rendering the
  // loading overlay — it has to be state (not just the ref) to trigger a
  // re-render, but it must never gate whether BlockNoteView itself mounts:
  // swapping the editor instance in/out based on a "ready" flag is exactly
  // what broke remote-update sync earlier (see the collab bootstrap effect).
  const [isContentLoading, setIsContentLoading] = useState(true);

  const saveTimeoutRef = useRef(null);
  const saveRetryTimeoutRef = useRef(null);
  const saveRetryCountRef = useRef(0);
  const idleCheckpointTimeoutRef = useRef(null);
  const fileRef = useRef(file);
  const workspaceIdRef = useRef(activeWorkspaceId);
  const titleRef = useRef(title);
  const tagsRef = useRef(tags);
  const saveStatusRef = useRef(saveStatus);
  // Gate onChange-triggered autosave with a ref (not state) so it can never race
  // against the async collaborative sync below — a ref is authoritative the
  // instant it's set, unlike state which commits on the next render.
  const isLoadingContentRef = useRef(true);
  const hasBootstrappedRef = useRef(false);

  fileRef.current = file;
  workspaceIdRef.current = activeWorkspaceId;
  titleRef.current = title;
  tagsRef.current = tags;
  saveStatusRef.current = saveStatus;

  useEffect(() => {
    let cancelled = false;
    getSyncUrl().then((url) => { if (!cancelled) setSyncUrl(url); });
    return () => { cancelled = true; };
  }, []);

  // The editor is created ONCE per file (as soon as ydoc+provider exist) and
  // never swapped out afterward — swapping the collaboration-bound editor
  // later (e.g. gating its creation on a "sync finished" flag) breaks the
  // y-sync plugin's remote-update binding: local edits still write into the
  // Yjs doc fine, but updates from other clients stop reaching the visible
  // ProseMirror view. So seeding happens through this SAME, already-mounted
  // editor's own replaceBlocks — never a second, throwaway editor instance.
  const editorRef = useRef(null);

  // One Yjs doc + Hocuspocus room per open document, created AND torn down in
  // the same effect (not useMemo-for-creation + a separate cleanup effect).
  // Under StrictMode (main.jsx wraps the app in it) React deliberately runs
  // mount -> cleanup -> mount once; HocuspocusProvider.destroy() unregisters
  // its own document "update" listener as part of that cleanup. useMemo has
  // no matching "re-run" signal when its deps haven't changed, so the second
  // mount would keep reusing the SAME (already-torn-down) provider — it stays
  // connected and reports isSynced, but with its listener gone, local edits
  // never trigger a broadcast; they'd only go out via Hocuspocus's periodic
  // reconnect-checker eventually forcing a full resync, tens of seconds
  // later. Creating and destroying inside one effect makes React's second
  // mount build a genuinely fresh pair with a fresh listener, every time.
  const [collab, setCollab] = useState(null); // { ydoc, provider } | null

  useEffect(() => {
    if (!file?.id || !syncUrl) {
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
      newProvider.destroy();
      newYdoc.destroy();
    };
  }, [file?.id, syncUrl]);

  // WORKAROUND for an Android-only bug, unverified on a real device — see
  // explanation below. Confirmed NOT caused by BlockNote's table keymap
  // (reverted — reproduced with no table involved) and NOT a Yjs remote-
  // update/IME-composition collision (reproduces solo, in a brand-new
  // note, with plain ASCII, and persists across a full page reload — so
  // it isn't a stale in-tab render desync either). The one thing every
  // report has in common is a real Android device (Samsung Internet AND
  // Chrome both show it — same OS, different engines — so it's not one
  // browser's bug specifically).
  //
  // prosemirror-view's own source (see its `handlers.beforeinput`) admits
  // it barely handles `beforeinput` events: "support is so spotty that
  // I'm still waiting to see where they are going" — Enter is normally
  // handled purely via the legacy `keydown` → keymap path. But several
  // Android keyboards (Gboard, Samsung Keyboard) commit text and newlines
  // through the modern `beforeinput`/`InputConnection` API instead of a
  // clean `keydown`, so BOTH paths can fire for one Enter press: the
  // keymap's own controlled transaction, AND the browser's native,
  // uncontrolled contenteditable mutation that ProseMirror's DOM-mutation
  // observer then has to reverse-engineer — which is exactly the kind of
  // guesswork that can split freshly-typed text into arbitrary chunks in
  // a collaborative (Yjs-backed) document.
  //
  // Mitigation: intercept `beforeinput` directly, suppress the browser's
  // own native mutation with `preventDefault()`, and re-dispatch a real
  // synthetic `Enter` `keydown` so ONLY ProseMirror's own (already
  // correct) keymap path ever runs — never the native/observer path. This
  // mirrors a pattern ProseMirror's own view code already uses internally
  // for a different Android backspace bug (same file, `beforeinput.
  // deleteContentBackward` case) — not a novel technique.
  //
  // UNVERIFIED: could not reproduce this bug at all via automation (no
  // tool available here can simulate a real Android virtual keyboard's
  // actual event sequence), so this fix is based on the mechanism being a
  // documented, known gap rather than on confirming it actually resolves
  // the reported symptom. Needs a real-device retest. If it doesn't help,
  // remove it rather than layering more guesses on top — the next
  // diagnostic step at that point is capturing the actual `beforeinput`/
  // `keydown` event sequence on the failing device (e.g. via remote
  // debugging / chrome://inspect) rather than reasoning from source code.
  const AndroidBeforeInputEnterFix = Extension.create({
    name: 'finderAndroidBeforeInputEnterFix',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              beforeinput(view, event) {
                if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') return false;
                event.preventDefault();
                view.dom.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  shiftKey: event.inputType === 'insertLineBreak',
                  bubbles: true,
                  cancelable: true
                }));
                return true;
              }
            }
          }
        })
      ];
    }
  });

  const editor = useCreateBlockNote(
    collab
      ? withCollaboration({
          schema: blockNoteSchema,
          dictionary: blockNoteKo,
          _tiptapOptions: { extensions: [AndroidBeforeInputEnterFix] },
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
      : { schema: blockNoteSchema, dictionary: blockNoteKo, _tiptapOptions: { extensions: [AndroidBeforeInputEnterFix] } },
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

  // Long-open notes can outlast the 15-min media token — periodically re-point any
  // embedded image blocks at a current one so previews don't silently go stale.
  useEffect(() => {
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
  }, [editor]);

  // With several people editing the same document at once, every connected client's
  // onChange fires for everyone's edits (local and remote), so naively saving on
  // each one would re-run the save (and its embedding re-index) once per connected
  // client per edit. Elect the peer with the lowest Yjs client id as the one
  // responsible for persisting to Postgres — deterministic and needs no extra
  // coordination beyond awareness state every client already has.
  const isSaveLeader = useCallback(() => {
    if (!collab?.provider?.awareness) return true;
    const ids = Array.from(collab.provider.awareness.getStates().keys());
    if (ids.length === 0) return true;
    return collab.ydoc.clientID === Math.min(...ids);
  }, [collab]);

  const doSave = useCallback(async (newTitle, newTags) => {
    setSaveStatus('saving');
    try {
      const markdown = editor.blocksToMarkdownLossy(editor.document);
      await onSave({ name: newTitle, content: markdown, tags: newTags });
      setSaveStatus('saved');
      setSaveError(null);
      saveRetryCountRef.current = 0;
    } catch (err) {
      const message = err?.message || '알 수 없는 오류';
      setSaveStatus('unsaved');
      setSaveError(message);
      console.error('Auto-save error:', err);
      // Most failures here are transient (a network blip, a momentarily
      // expired token) and would otherwise leave the note silently stuck on
      // "미저장" with no explanation until the user happens to type again.
      // Retry a couple of times with backoff before giving up — bounded so a
      // persistent failure (e.g. quota exceeded) doesn't retry forever; the
      // error message stays visible either way via the status tooltip.
      if (saveRetryCountRef.current < 2) {
        saveRetryCountRef.current += 1;
        if (saveRetryTimeoutRef.current) clearTimeout(saveRetryTimeoutRef.current);
        saveRetryTimeoutRef.current = setTimeout(() => {
          saveRetryTimeoutRef.current = null;
          doSave(newTitle, newTags);
        }, saveRetryCountRef.current * 5000);
      }
    }
  }, [editor, onSave]);

  const triggerAutoSave = useCallback((newTitle, newTags) => {
    setSaveStatus('unsaved');
    saveRetryCountRef.current = 0;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (saveRetryTimeoutRef.current) {
      clearTimeout(saveRetryTimeoutRef.current);
      saveRetryTimeoutRef.current = null;
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      if (!isSaveLeader()) {
        // Only the leader persists to Postgres, but this client's own edits
        // are already merged into the shared Yjs doc the instant they're
        // made — nothing is actually at risk of being lost. Showing a
        // permanent "미저장" here (which used to just return and never
        // recover) misrepresented that as a real failure.
        setSaveStatus('saved');
        return;
      }
      doSave(newTitle, newTags);
    }, 1000);
  }, [doSave, isSaveLeader]);

  // Every real edit pushes this out by IDLE_CHECKPOINT_DELAY — once it
  // actually fires (no further edits for that long), the note is treated as
  // "done for now" and gets its own version-history entry, same as Notion
  // closing out a session the moment you stop typing.
  const scheduleIdleCheckpoint = useCallback(() => {
    if (idleCheckpointTimeoutRef.current) clearTimeout(idleCheckpointTimeoutRef.current);
    idleCheckpointTimeoutRef.current = setTimeout(() => {
      idleCheckpointTimeoutRef.current = null;
      if (!isSaveLeader() || !fileRef.current?.id) return;
      checkpointFileVersion(fileRef.current.id).catch(() => {});
    }, IDLE_CHECKPOINT_DELAY);
  }, [isSaveLeader]);

  // Independent of the idle timer above: forces a checkpoint on a fixed
  // cadence regardless of how long editing continues without a pause, so a
  // long uninterrupted session still accumulates real history entries along
  // the way instead of just one at the very end. Checkpointing is a no-op
  // on the backend if nothing changed since the last one, so firing this
  // unconditionally every interval is harmless.
  useEffect(() => {
    if (!file?.id) return;
    const interval = setInterval(() => {
      if (!isSaveLeader()) return;
      checkpointFileVersion(file.id).catch(() => {});
    }, PERIODIC_CHECKPOINT_INTERVAL);
    return () => clearInterval(interval);
  }, [file?.id, isSaveLeader]);

  // Flush a pending save immediately when the tab is hidden/closed, instead of
  // losing up to 1s of edits (the autosave debounce window) or waiting for the
  // next periodic save — a session-boundary flush, the same signal most
  // collaborative editors use to decide "this edit is worth a history entry."
  // Closing/hiding the tab is itself a session boundary, so it also forces the
  // same version-history checkpoint the idle timer would eventually trigger,
  // once the flushed save (if any) actually lands.
  useEffect(() => {
    const flush = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (idleCheckpointTimeoutRef.current) {
        clearTimeout(idleCheckpointTimeoutRef.current);
        idleCheckpointTimeoutRef.current = null;
      }
      if (!isSaveLeader()) return;
      const pending = saveStatusRef.current === 'saved' ? Promise.resolve() : doSave(titleRef.current, tagsRef.current);
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
  }, [doSave, isSaveLeader]);

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

  // Restoring a version already persisted the new content on the backend —
  // this just makes the live editor (and, via Yjs, every other connected
  // client) reflect it, by replacing blocks the exact same way the initial
  // collaborative bootstrap does. That replaceBlocks call is itself a normal
  // local edit, so the usual autosave fires afterward and re-PUTs the same
  // (now-matching) content — redundant but harmless, no special-casing needed.
  const handleVersionRestored = async (updatedFile) => {
    const processed = await refreshImageTokensInMarkdown(updatedFile.content || '');
    const blocks = upgradeVideoLinks(editor.tryParseMarkdownToBlocks(processed || ' '));
    editor.replaceBlocks(editor.document, blocks);
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


  return (
    <div className="editor-layout">
      {/* 1. Top Header Actions */}
      <div className="editor-header" style={{ padding: '0.65rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <button className="btn-icon" onClick={onBack} title="목록으로 돌아가기">
            <ArrowLeft size={18} />
          </button>

          <span
            style={{
              fontSize: '0.75rem',
              color: saveStatus === 'saved' ? 'var(--accent-emerald)' : (saveStatus === 'unsaved' && saveError ? 'var(--accent-rose)' : 'var(--accent-amber)'),
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
            title={saveStatus === 'unsaved' && saveError ? `저장 실패: ${saveError}` : undefined}
          >
            {saveStatus === 'saved' ? '● 자동 저장됨' : (saveStatus === 'saving' ? '⟳ 저장 중...' : (saveError ? '⚠ 저장 실패' : '○ 미저장'))}
          </span>

          {syncStatus === 'error' && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-rose)' }} title="실시간 동기화 서버에 연결할 수 없습니다. 이 브라우저에서만 편집이 저장됩니다.">
              ⚠ 실시간 동기화 연결 실패
            </span>
          )}

          {isUploadingImage && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={13} className="spin" /> 이미지 업로드 중...
            </span>
          )}
        </div>

        {/* Action controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button className="btn-icon" onClick={handleExportMarkdown} title="마크다운 다운로드 (.md)">
            <Download size={16} />
          </button>

          <button
            className="btn-icon"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            title="PDF로 내보내기 / 인쇄"
          >
            {isExportingPdf ? (
              <Loader2 size={16} className="spin" color="var(--accent-rose)" />
            ) : (
              <FileText size={16} color="var(--accent-rose)" />
            )}
          </button>

          {file && (
            <>
              <button
                className="btn-icon"
                onClick={() => setIsHistoryModalOpen(true)}
                title="문서 히스토리"
              >
                <Clock size={16} />
              </button>
              <button
                className="btn-icon"
                onClick={() => onToggleFavorite(file)}
                title="즐겨찾기 토글"
              >
                <Star
                  size={16}
                  color={file.is_favorite ? '#f59e0b' : 'var(--text-muted)'}
                  fill={file.is_favorite ? '#f59e0b' : 'none'}
                />
              </button>
              <button
                className="btn-icon"
                onClick={() => onDelete(file.id)}
                title="문서 삭제"
              >
                <Trash2 size={16} color="var(--accent-rose)" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. Dedicated Full-Width Title Row */}
      <div className="editor-title-row" style={{ padding: '0.65rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <input
          type="text"
          className="editor-title-input"
          value={title}
          onChange={handleTitleChange}
          placeholder="문서 제목을 입력하세요..."
          style={{ width: '100%', fontSize: '1.2rem', fontWeight: 700, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', padding: '0.2rem 0' }}
        />
      </div>

      {/* 3. Block Editor */}
      <div className="editor-panes">
        {isContentLoading && (
          <div className="editor-loading-overlay">
            <Loader2 size={20} className="spin" color="var(--accent-primary)" />
            <span>내용을 불러오는 중...</span>
          </div>
        )}
        <div className="editor-pane-blocknote">
          <BlockNoteView editor={editor} theme={BN_THEME} onChange={handleEditorChange} slashMenu={false}>
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) => filterSuggestionItems(
                [
                  ...getDefaultReactSlashMenuItems(editor),
                  {
                    title: '보관함 파일 첨부',
                    onItemClick: () => {
                      insertOrUpdateBlockForSlashMenu(editor, { type: 'paragraph' });
                      setIsAttachModalOpen(true);
                    },
                    aliases: ['file', 'attach', '파일', '첨부', '보관함'],
                    group: '미디어',
                    icon: <Paperclip size={18} />,
                    subtext: '보관함에 이미 저장된 파일을 첨부합니다'
                  }
                ],
                query
              )}
            />
          </BlockNoteView>
        </div>
      </div>

      <AttachExistingFileModal
        isOpen={isAttachModalOpen}
        onClose={() => setIsAttachModalOpen(false)}
        onInsertMarkdown={handleInsertAttachedFile}
      />

      {file && (
        <VersionHistoryModal
          fileId={file.id}
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          onRestored={handleVersionRestored}
        />
      )}
    </div>
  );
}
