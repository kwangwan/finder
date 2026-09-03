import { useState, useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteSchema, defaultBlockSpecs, cleanHTMLToMarkdown } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { ko as blockNoteKo } from '@blocknote/core/locales';
import { Extension } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';
import {
  uploadNoteImage,
  ensureMediaToken,
  getMediaPreviewUrl,
  getFileDownloadUrl,
  getThumbnailUrl,
  getStoredToken,
  getAuthConfig,
  updateMarkdownNote
} from '../api';
import { getVideoEmbedUrl, VIDEO_EMBED_LINK_TEXT } from '../utils/markdownLinkComponents';
import { exportMarkdownToPdf } from '../utils/pdfExport';
import { useDialog } from '../context/DialogContext';

const COLLAB_FRAGMENT_NAME = 'blocknote';

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
    selected: { text: 'var(--on-accent)', background: 'var(--accent-primary)' },
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

// BlockNote's own parsers for these two read only the URL out of the element
// they were given, so the file's name — which is the entire visible content of
// a 파일 attachment, and the label under a player — was dropped on the way back
// in. Both are written by `attachmentFigureHtml` below as a `data-name`, the
// same attribute the video block already uses, and recovered here. Remove
// these two overrides if a future BlockNote reads the name itself.
function parseWithName(spec, targetTag) {
  return function parse(element) {
    const props = spec.implementation.parse?.call(this, element);
    if (!props) return props;
    const target = element.tagName.toLowerCase() === targetTag
      ? element
      : element.querySelector(targetTag);
    const name = target?.getAttribute('data-name');
    return name && !props.name ? { ...props, name } : props;
  };
}

const stockAudioSpec = defaultBlockSpecs.audio;
const stockFileSpec = defaultBlockSpecs.file;

export const blockNoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    video: {
      ...stockVideoSpec,
      implementation: {
        ...stockVideoSpec.implementation,
        render: renderVideoBlock,
        toExternalHTML: videoBlockToExternalHTML
      }
    },
    audio: {
      ...stockAudioSpec,
      implementation: {
        ...stockAudioSpec.implementation,
        parse: parseWithName(stockAudioSpec, 'audio')
      }
    },
    file: {
      ...stockFileSpec,
      implementation: {
        ...stockFileSpec.implementation,
        parse: parseWithName(stockFileSpec, 'embed')
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

// One of this app's own media URLs, in every shape it can arrive in: written
// as a plain path or with an origin in front of it (the browser resolves a
// relative src to an absolute one, and that absolute form comes back out of
// the editor), and with or without the short-lived media token.
const MEDIA_URL_RE = /(?:https?:\/\/[^/\s"')]+)?\/api\/storage\/(preview|download|thumbnail)\/([0-9a-fA-F-]{36})(?:\?[^\s"')\]]*)?/g;

const MEDIA_URL_BUILDERS = {
  preview: getMediaPreviewUrl,
  download: getFileDownloadUrl,
  thumbnail: getThumbnailUrl,
};

/**
 * The stored form of every attachment URL: a plain path, no token.
 *
 * A media token lives for minutes and is a credential; writing one into the
 * document meant the saved markdown carried an expired one for every
 * attachment that was not an image (nothing ever refreshed those), so a file
 * attached today opened to a 401 tomorrow. The document says *which* file it
 * points at, and nothing more — the token is put back on the way in.
 */
function stripMediaTokens(markdown) {
  if (!markdown || !markdown.includes('/api/storage/')) return markdown;
  return markdown.replace(MEDIA_URL_RE, (_m, kind, id) => `/api/storage/${kind}/${id}`);
}

/** The same URLs with a token that works right now, for the editor to load. */
async function addMediaTokens(markdown) {
  if (!markdown || !markdown.includes('/api/storage/')) return markdown;
  await ensureMediaToken();
  return markdown.replace(MEDIA_URL_RE, (match, kind, id) => {
    const build = MEDIA_URL_BUILDERS[kind];
    return build ? build(id) : match;
  });
}

const MEDIA_ID_RE = /\/api\/storage\/(?:preview|download|thumbnail)\/([0-9a-fA-F-]{36})/;

// Every block that points at a file: a picture, a player, or a card with a
// file name on it. All four are refreshed on the same timer — an image was,
// and a video whose token had expired simply stopped playing.
const ATTACHMENT_BLOCK_TYPES = new Set(['image', 'video', 'audio', 'file']);

function collectAttachmentBlocks(blocks, acc = []) {
  for (const block of blocks) {
    if (ATTACHMENT_BLOCK_TYPES.has(block.type) && block.props?.url) acc.push(block);
    if (block.children && block.children.length) collectAttachmentBlocks(block.children, acc);
  }
  return acc;
}

// Whether there is anything at all in the editor. Read from the blocks rather
// than by converting to markdown, because this is asked on every keystroke.
// Anything that is not text — a picture, a table, an attachment — counts as
// content whatever it holds.
const TEXTUAL_BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'quote', 'codeBlock',
  'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem',
]);

function isEditorEmpty(editor) {
  const walk = (blocks) => blocks.every((block) => {
    if (!TEXTUAL_BLOCK_TYPES.has(block.type)) return false;
    const text = Array.isArray(block.content)
      ? block.content.map((node) => node.text || '').join('')
      : (block.content || '');
    return !text.trim() && (!block.children?.length || walk(block.children));
  });
  return walk(editor?.document || []);
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
// a cell (one row = one line), and BlockNote's own markdown exporter doesn't
// special-case that: htmlToMarkdown.ts's `case "br": result += "\\\n"` fires
// for a <br> anywhere, table cell or not — so a soft line break (Shift+Enter,
// or an Android keyboard's beforeinput insertLineBreak) typed into a cell
// exports as a hard-break escape followed by a REAL "\n", which then
// re-parses as an extra, misaligned table row the next time the note is
// reopened (Hocuspocus re-seeds from the stored markdown once its last
// client disconnects — see the Yjs-room-unload note elsewhere in this
// codebase).
//
// Worked around at the export step, using only BlockNote's own public API,
// rather than blocking the keystroke — `editor.blocksToHTMLLossy()` produces
// the exact same intermediate HTML that `blocksToMarkdownLossy()` would feed
// into that broken table-unaware step internally (both call the identical
// `createExternalHTMLExporter(...).exportBlocks(...)`, confirmed by reading
// ExportManager.ts/markdownExporter.ts). So: get that HTML ourselves, swap
// every <br> that's a descendant of a <table> for a plain private-use-area
// placeholder text node (immune to every markdown-escaping rule since it's
// just text), convert with the same public `cleanHTMLToMarkdown` BlockNote
// uses internally, then turn the placeholder back into a literal `<br>` in
// the final markdown text. A literal `<br>` sitting on one line already
// round-trips correctly on load with ZERO changes needed on the parse side —
// BlockNote's markdown parser (`tryInlineHtml` in markdownToHtml.ts) already
// passes raw inline HTML tags straight through into a real hard break inside
// a cell; only the export side was missing the table-aware case. Remove this
// workaround if a future BlockNote version fixes htmlToMarkdown.ts's `<br>`
// case to check for a table-cell ancestor itself.
const TABLE_BR_PLACEHOLDER = '\uE000BR\uE000';

// An empty paragraph is real content in the editor — it is the blank line the
// user deliberately left between two paragraphs — but it does not survive a
// markdown round-trip on its own. Export writes it as nothing, so a run of
// them becomes a run of blank lines, and blank lines are not content in
// markdown: every parser collapses them. Reopening a document therefore
// silently dropped every blank line the user had typed.
//
// The information is not lost on the way out — the saved markdown does hold
// those blank lines — so the repair belongs on the way back in. Each surplus
// blank line is turned into a line holding one zero-width space, which IS
// content and does parse to a paragraph, and that paragraph is emptied again
// once parsed (restoreBlankParagraphs). Same shape as the table <br>
// workaround above, and the markdown on disk stays untouched and valid.
// Zero-width space, not a non-breaking space: BlockNote's markdown parser
// treats a line holding only an nbsp as blank and drops it, which is exactly
// the behaviour being worked around. Verified against the parser rather than
// assumed. Nothing ever sees this character — the paragraph is emptied the
// moment it is parsed — so its only requirement is to survive that step.
const BLANK_PARAGRAPH_CHAR = '\u200B';

/**
 * Re-materialise the empty paragraphs that a run of blank lines stands for.
 *
 * BlockNote separates blocks with one blank line, so a run of B blank lines
 * carries (B - 1) / 2 empty paragraphs between its neighbours. Fenced code
 * blocks are skipped: blank lines are literal content there, and rewriting
 * them would corrupt the code.
 */
export function expandBlankParagraphs(markdown) {
  if (!markdown || !markdown.includes('\n\n\n')) return markdown;

  const lines = markdown.split('\n');
  const out = [];
  let inFence = false;
  let run = 0;

  const flushRun = () => {
    if (run === 0) return;
    const paragraphs = inFence ? 0 : Math.floor((run - 1) / 2);
    out.push('');
    for (let i = 0; i < paragraphs; i++) {
      out.push(BLANK_PARAGRAPH_CHAR);
      out.push('');
    }
    // Anything not accounted for by a paragraph pair is ordinary spacing and
    // is dropped, exactly as a markdown parser would drop it.
    run = 0;
  };

  for (const line of lines) {
    const isFence = /^\s*(```|~~~)/.test(line);
    if (isFence) {
      if (run) { for (let i = 0; i < run; i++) out.push(''); run = 0; }
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (line.trim() === '') { run += 1; continue; }
    flushRun();
    out.push(line);
  }
  if (run) { out.push(''); }

  return out.join('\n');
}

// An attachment that is not a picture does not survive a markdown round trip.
// BlockNote's exporter writes a video as `![name](url)`, an audio as a bare
// `<audio>` tag and a file as `[name](url)`; its parser only turns the first
// of those back into a video when the URL *ends in a video extension*, which
// this app's `/api/storage/preview/<id>` never does. So a video came back as a
// broken picture and a file as a plain link — attachments looked right until
// the document was reopened.
//
// Written instead as the `<figure>` form BlockNote's own parsers do recognise
// for all three (parseFigureElement, see the block specs in @blocknote/core),
// which every markdown parser passes through untouched because `figure` is a
// block-level HTML tag. Done by swapping each attachment block for a
// placeholder paragraph before the export and putting the figure back after
// it, rather than by rewriting the exporter's HTML, so the placeholder text is
// the only thing that has to survive the conversion.
const ATTACHMENT_BLOCK_MARKDOWN_TYPES = new Set(['video', 'audio', 'file']);
const ATTACHMENT_PLACEHOLDER = (index) => `\uE001ATT${index}\uE001`;

function escapeHtmlAttr(value) {
  return String(value).replace(/\s+/g, ' ').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlText(value) {
  return String(value).replace(/\s+/g, ' ').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attachmentFigureHtml(block) {
  const { url, name, caption } = block.props || {};
  // On one line, always: a raw HTML block in markdown ends at the first blank
  // line, so a caption someone typed a line break into would cut the figure in
  // half and leave the rest of it showing as text.
  const nameAttr = name ? ` data-name="${escapeHtmlAttr(name)}"` : '';
  const inner = block.type === 'file'
    ? `<embed src="${escapeHtmlAttr(url)}"${nameAttr}>`
    : `<${block.type} src="${escapeHtmlAttr(url)}"${nameAttr} controls></${block.type}>`;
  const figcaption = caption ? `<figcaption>${escapeHtmlText(caption)}</figcaption>` : '';
  return `<figure>${inner}${figcaption}</figure>`;
}

function extractAttachments(blocks, collected) {
  return blocks.map((block) => {
    const children = block.children?.length ? extractAttachments(block.children, collected) : block.children;
    // A YouTube-style embed keeps its own representation (a link the load side
    // turns back into a player), so it is left to that path.
    const isEmbeddedVideo = block.type === 'video' && !!getVideoEmbedUrl(block.props?.url);
    if (ATTACHMENT_BLOCK_MARKDOWN_TYPES.has(block.type) && block.props?.url && !isEmbeddedVideo) {
      collected.push(attachmentFigureHtml(block));
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: ATTACHMENT_PLACEHOLDER(collected.length - 1), styles: {} }],
        children,
      };
    }
    return children === block.children ? block : { ...block, children };
  });
}

// Indentation — one block tucked under another with Tab — has no markdown of
// its own outside lists, and BlockNote's external-HTML exporter says so
// explicitly: everything but a list item is *flattened* to the top level on
// the way out ("default blockContainer style blocks are flattened (no nested
// block support) for externalHTML"). So an indented paragraph came back
// against the left margin every time a document was reopened.
//
// Recorded as this character, one per level, at the very start of the block's
// text, and taken off again when the document is read back. A private-use
// character for the same reason the table workaround above uses one: it can
// never be typed, no markdown rule gives it a meaning, and no parser trims it
// the way it would trim a space. Only blocks that hold text can carry it,
// which leaves an indented picture or attachment flat — they have no text to
// put it in, and the alternative would be markup no other editor could read.
const INDENT_MARK = '\uE002';
const LIST_BLOCK_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem']);
// A code block's content is the code: a marker in it would be a line of the
// program. A table's is cells, not text.
const UNMARKABLE_BLOCK_TYPES = new Set(['codeBlock', 'table']);

function prefixInlineContent(content, prefix) {
  if (typeof content === 'string') return prefix + content;
  if (!Array.isArray(content)) return content;
  const [first, ...rest] = content;
  if (first?.type === 'text') return [{ ...first, text: prefix + first.text }, ...rest];
  return [{ type: 'text', text: prefix, styles: {} }, ...content];
}

/**
 * Write each block's depth into its own text, so the flattening the exporter
 * does can be undone on the way back in.
 *
 * A list item inside a list item is left alone: markdown nests those itself,
 * and marking them too would count the same level twice.
 */
function markIndentation(blocks, parentType = null, parentMark = 0) {
  return blocks.map((block) => {
    const mark = parentType === null
      ? 0
      : (LIST_BLOCK_TYPES.has(block.type) && LIST_BLOCK_TYPES.has(parentType) ? parentMark : parentMark + 1);
    const children = block.children?.length ? markIndentation(block.children, block.type, mark) : block.children;
    const canMark = mark > 0 && block.content !== undefined && !UNMARKABLE_BLOCK_TYPES.has(block.type);
    const content = canMark ? prefixInlineContent(block.content, INDENT_MARK.repeat(mark)) : block.content;
    if (content === block.content && children === block.children) return block;
    return { ...block, content, children };
  });
}

function takeIndentMark(content) {
  const text = typeof content === 'string'
    ? content
    : (Array.isArray(content) && content[0]?.type === 'text' ? content[0].text : null);
  if (!text || text[0] !== INDENT_MARK) return { mark: 0, content };
  let mark = 0;
  while (text[mark] === INDENT_MARK) mark += 1;
  const rest = text.slice(mark);
  if (typeof content === 'string') return { mark, content: rest };
  const [, ...tail] = content;
  return { mark, content: rest ? [{ ...content[0], text: rest }, ...tail] : tail };
}

/**
 * Put the indented blocks back under the ones they belong to.
 *
 * `base` is the depth the list being walked already sits at, so a nested list
 * that markdown restored by itself is not counted a second time.
 */
export function restoreIndentation(blocks, base = 0) {
  const out = [];
  const anchors = [];
  for (const block of blocks) {
    const { mark, content } = takeIndentMark(block.content);
    const children = block.children?.length ? restoreIndentation(block.children, mark) : [];
    const next = { ...block, content, children: [...children] };
    const relative = mark - base;
    const parent = relative > 0 ? anchors[relative - 1] : null;
    if (parent) {
      parent.children.push(next);
      anchors.length = relative;
      anchors[relative] = next;
    } else {
      out.push(next);
      anchors.length = 0;
      anchors[0] = next;
    }
  }
  return out;
}

export function blocksToMarkdownTableSafe(editor, blocks) {
  const attachments = [];
  const prepared = extractAttachments(markIndentation(blocks), attachments);
  const html = editor.blocksToHTMLLossy(prepared);
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll('table br').forEach((br) => {
    br.replaceWith(document.createTextNode(TABLE_BR_PLACEHOLDER));
  });
  let markdown = cleanHTMLToMarkdown(container.innerHTML).split(TABLE_BR_PLACEHOLDER).join('<br>');
  attachments.forEach((figure, index) => {
    markdown = markdown.split(ATTACHMENT_PLACEHOLDER(index)).join(figure);
  });
  return stripMediaTokens(markdown);
}

// A document written before attachments had a form of their own holds each one
// as an ordinary link to a file in the workspace, which is why an attachment
// that had been saved once came back as a line of blue text instead of the
// card it was inserted as. A paragraph that is nothing but a link to a file
// here is that, and is turned back into the attachment it stands for — a
// repair on the way in, so no stored document has to be rewritten for it.
//
// Only files: a picture written as `![]()` still parses as a picture, but a
// *video* attached before this change was written the same way and cannot be
// told apart from one by its URL alone, so an old video attachment stays a
// (broken) picture until it is attached again.
const ATTACHMENT_LINK_RE = /^(?:https?:\/\/[^/]+)?\/api\/(?:storage\/(?:preview|download|presigned-download)\/[0-9a-fA-F-]{36}|files\/[0-9a-fA-F-]{36}\/download)(?:\?[^\s]*)?$/;

function upgradeAttachmentLinks(blocks) {
  return blocks.map((block) => {
    const children = block.children?.length ? upgradeAttachmentLinks(block.children) : block.children;
    if (block.type === 'paragraph' && block.content?.length === 1) {
      const node = block.content[0];
      if (node?.type === 'link' && ATTACHMENT_LINK_RE.test(node.href || '')) {
        const name = (node.content || []).map((n) => n.text || '').join('');
        return { type: 'file', props: { url: node.href, name }, children };
      }
    }
    return children === block.children ? block : { ...block, children };
  });
}

/** Markdown as it is stored turned into blocks as the editor holds them. */
export function markdownToBlocks(editor, markdown) {
  const parsed = editor.tryParseMarkdownToBlocks(expandBlankParagraphs(markdown) || ' ');
  const blocks = restoreBlankParagraphs(upgradeAttachmentLinks(upgradeVideoLinks(restoreIndentation(parsed))));
  // replaceBlocks refuses an empty list, and a document that parsed to nothing
  // is an empty document, not a missing one.
  return blocks.length ? blocks : [{ type: 'paragraph' }];
}

/**
 * Turn the encoded blank lines back into empty paragraphs on load.
 *
 * Runs on parsed blocks rather than on the markdown text so it can only ever
 * affect a paragraph whose entire content is the marker — a non-breaking
 * space the user typed inside a real sentence is untouched.
 */
export function restoreBlankParagraphs(blocks) {
  return blocks.map((block) => {
    const children = block.children?.length ? restoreBlankParagraphs(block.children) : block.children;
    if (block.type === 'paragraph' && block.content?.length === 1) {
      const node = block.content[0];
      if (node?.type === 'text' && node.text === BLANK_PARAGRAPH_CHAR) {
        return { ...block, content: [], children };
      }
    }
    return children === block.children ? block : { ...block, children };
  });
}

/**
 * Owns everything a collaborative BlockNote note editor needs: the Yjs
 * doc/Hocuspocus room, the BlockNote editor instance, the autosave, and the
 * markdown round-trip fixups. Version history needs nothing from here — the
 * server keeps one entry per half hour off the saves themselves.
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
  const fileRef = useRef(file);
  const workspaceIdRef = useRef(activeWorkspaceId);
  const titleRef = useRef(title);
  const tagsRef = useRef(tags);
  const saveStatusRef = useRef(saveStatus);
  const onFileUpdatedRef = useRef(onFileUpdated);
  const isLoadingContentRef = useRef(true);
  const hasBootstrappedRef = useRef(false);
  const editorRef = useRef(null);
  // Whether the document we are editing has any text in it, and whether it was
  // this person who took the text out. Together they are what tells an ordinary
  // "select all, delete" — which must save — from an editor that is empty for
  // some other reason, which must never be written over the document. See the
  // guard in doSave.
  const hasContentRef = useRef(!!(file?.content || '').trim());
  const emptiedHereRef = useRef(false);

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
    const markdown = blocksToMarkdownTableSafe(editorRef.current, editorRef.current.document);
    // A document that has been open for hours can be emptied without anybody
    // touching it — a torn-down and rebuilt editor, a collaborative room that
    // came back without its content — and the autosave then wrote that
    // emptiness over the real document, which had to be dug back out of the
    // history. An empty save is only ever legitimate when the emptying
    // happened here, in front of the person doing it.
    if (!markdown.trim() && hasContentRef.current && !emptiedHereRef.current) {
      console.warn('[NoteEditor] refused to save an empty document that was not emptied here');
      setSaveStatus('saved');
      return;
    }
    setSaveStatus('saving');
    try {
      const updated = await updateMarkdownNote(fileRef.current.id, { name: newTitle, content: markdown, tags: newTags });
      setSaveStatus('saved');
      setSaveError(null);
      hasContentRef.current = !!markdown.trim();
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
            const stored = fileRef.current?.content || '';
            hasContentRef.current = !!stored.trim();
            emptiedHereRef.current = false;
            const blocks = markdownToBlocks(editorRef.current, await addMediaTokens(stored));
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

  const editor = useCreateBlockNote(
    collab
      ? withCollaboration({
          schema: blockNoteSchema,
          dictionary: blockNoteKo,
          _tiptapOptions: { extensions: [androidBeforeInputEnterFixRef.current] },
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
      : { schema: blockNoteSchema, dictionary: blockNoteKo, _tiptapOptions: { extensions: [androidBeforeInputEnterFixRef.current] } },
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
      const attachments = collectAttachmentBlocks(editor.document)
        .filter((b) => MEDIA_ID_RE.test(b.props.url));
      if (attachments.length === 0) return;
      await ensureMediaToken();
      attachments.forEach((b) => {
        const idMatch = b.props.url.match(MEDIA_ID_RE);
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

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (!isSaveLeaderRef.current()) return;
      if (saveStatusRef.current !== 'saved') doSaveRef.current(titleRef.current, tagsRef.current);
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
  };

  const handleEditorChange = () => {
    if (isLoadingContentRef.current) return;
    // Recorded at the moment the editor itself reports the change, which is
    // the only moment an empty document can be known to be somebody's doing.
    emptiedHereRef.current = isEditorEmpty(editorRef.current);
    triggerAutoSave(titleRef.current, tagsRef.current);
  };

  /**
   * Attach a file that is already in the workspace.
   *
   * Inserted as the block its type deserves — a picture as a picture, a video
   * as a player — rather than as a download link for everything, which is
   * what "첨부" used to mean here. The same file can be attached to as many
   * documents as it is useful in; nothing is copied and nothing is moved.
   */
  const handleInsertExistingFile = (picked) => {
    if (!picked?.id) return;
    const url = getMediaPreviewUrl(picked.id);
    const type = picked.file_type === 'image' ? 'image'
      : picked.file_type === 'video' ? 'video'
        : picked.file_type === 'audio' ? 'audio' : 'file';
    const cursor = editor.getTextCursorPosition();
    editor.insertBlocks(
      [{ type, props: type === 'video' ? { url } : { url, name: picked.name } }],
      cursor.block,
      'after',
    );
    handleEditorChange();
  };

  const handleVersionRestored = async (updatedFile) => {
    const blocks = markdownToBlocks(editor, await addMediaTokens(updatedFile.content || ''));
    editor.replaceBlocks(editor.document, blocks);
    hasContentRef.current = !!(updatedFile.content || '').trim();
    emptiedHereRef.current = false;
    onFileUpdatedRef.current?.(updatedFile);
  };

  const handleExportMarkdown = () => {
    const markdown = blocksToMarkdownTableSafe(editor, editor.document);
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
      const markdown = blocksToMarkdownTableSafe(editor, editor.document);
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
    handleInsertExistingFile,
    handleVersionRestored,
    handleExportMarkdown,
    handleExportPdf
  };
}
