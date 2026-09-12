import React, { useCallback, useRef, useState } from 'react';
import { useEditorChange, useEditorSelectionChange } from '@blocknote/react';
import {
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, Quote,
  Bold, Italic, Strikethrough, Code, Image as ImageIcon, Film, Paperclip,
  Table, Loader2,
} from '../../utils/icons';

/**
 * The things a document can be made of, on a bar above it.
 *
 * Everything here could already be done by typing "/" or by knowing markdown,
 * which is fine for whoever knows that and invisible to everyone else. The bar
 * says what a document can hold by showing it.
 *
 * Each block button is a toggle: pressing the one already in effect puts the
 * block back to ordinary text, which is why there is no separate "본문" button
 * to hunt for.
 */

const BLOCK_BUTTONS = [
  { type: 'heading', props: { level: 1 }, icon: Heading1, label: '제목 1' },
  { type: 'heading', props: { level: 2 }, icon: Heading2, label: '제목 2' },
  { type: 'heading', props: { level: 3 }, icon: Heading3, label: '제목 3' },
  { divider: true },
  { type: 'bulletListItem', icon: List, label: '글머리 기호 목록' },
  { type: 'numberedListItem', icon: ListOrdered, label: '번호 목록' },
  { type: 'checkListItem', icon: CheckSquare, label: '체크 목록' },
  { type: 'quote', icon: Quote, label: '인용' },
];

/** Two by two, empty: a table with no rows is not a table the editor accepts. */
function emptyTable() {
  const row = () => ({ cells: [[], []] });
  return { type: 'table', content: { type: 'tableContent', rows: [row(), row()] } };
}

const STYLE_BUTTONS = [
  { style: 'bold', icon: Bold, label: '굵게' },
  { style: 'italic', icon: Italic, label: '기울임' },
  { style: 'strike', icon: Strikethrough, label: '취소선' },
  { style: 'code', icon: Code, label: '코드' },
];

export default function DocumentToolbar({ editor, onUploadFile, onAttachExisting, isUploading = false }) {
  // Pressing a button must not take the caret out of the document: 굵게 acts on
  // what is selected, and the selection is gone the moment the button takes
  // focus. Preventing the press's default keeps focus where it was.
  const keepSelection = (event) => event.preventDefault();
  // Redrawn as the caret moves and as the document changes, so the buttons
  // show what the block under the caret actually is.
  const [, redraw] = useState(0);
  const bump = useCallback(() => redraw((n) => n + 1), []);
  useEditorSelectionChange(bump, editor);
  useEditorChange(bump, editor);

  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const currentBlock = (() => {
    try {
      return editor.getTextCursorPosition()?.block || null;
    } catch (e) {
      return null;
    }
  })();
  const activeStyles = (() => {
    try {
      return editor.getActiveStyles() || {};
    } catch (e) {
      return {};
    }
  })();

  const isBlockActive = (button) => {
    if (!currentBlock || currentBlock.type !== button.type) return false;
    if (!button.props) return true;
    return Object.entries(button.props).every(([key, value]) => currentBlock.props?.[key] === value);
  };

  const applyBlock = (button) => {
    const block = editor.getTextCursorPosition()?.block;
    if (!block) return;
    // Pressing the one already in effect goes back to ordinary text.
    const next = isBlockActive(button) ? { type: 'paragraph', props: {} } : { type: button.type, props: button.props || {} };
    editor.updateBlock(block, next);
    editor.focus();
  };

  const applyStyle = (style) => {
    editor.toggleStyles({ [style]: true });
    editor.focus();
  };

  const insertBlockAfterCursor = (block) => {
    const cursor = editor.getTextCursorPosition();
    if (!cursor) return;
    editor.insertBlocks([block], cursor.block, 'after');
    editor.focus();
  };

  const pick = (ref) => {
    // Cleared first, so choosing the same file twice in a row still counts as
    // a change.
    if (ref.current) {
      ref.current.value = '';
      ref.current.click();
    }
  };

  const handlePicked = async (event) => {
    const file = event.target.files?.[0];
    if (file) await onUploadFile?.(file);
  };

  return (
    <div className="doc-toolbar" role="toolbar" aria-label="문서 서식">
      {BLOCK_BUTTONS.map((button, index) => (button.divider ? (
        <span key={`d${index}`} className="doc-toolbar-divider" />
      ) : (
        <button
          key={button.label}
          type="button"
          className={`doc-toolbar-btn ${isBlockActive(button) ? 'is-on' : ''}`}
          title={`${button.label}${isBlockActive(button) ? ' (다시 누르면 본문)' : ''}`}
          aria-pressed={isBlockActive(button)}
          onMouseDown={keepSelection}
          onClick={() => applyBlock(button)}
        >
          <button.icon size={15} />
        </button>
      )))}

      <span className="doc-toolbar-divider" />

      {STYLE_BUTTONS.map((button) => (
        <button
          key={button.style}
          type="button"
          className={`doc-toolbar-btn ${activeStyles[button.style] ? 'is-on' : ''}`}
          title={button.label}
          aria-pressed={!!activeStyles[button.style]}
          onMouseDown={keepSelection}
          onClick={() => applyStyle(button.style)}
        >
          <button.icon size={15} />
        </button>
      ))}

      <span className="doc-toolbar-divider" />

      <button
        type="button"
        className="doc-toolbar-btn"
        title="표 넣기"
        onMouseDown={keepSelection}
        onClick={() => insertBlockAfterCursor(emptyTable())}
      >
        <Table size={15} />
      </button>
      <button
        type="button"
        className="doc-toolbar-btn"
        title="이미지 올리기"
        disabled={isUploading}
        onMouseDown={keepSelection}
        onClick={() => pick(imageInputRef)}
      >
        {isUploading ? <Loader2 size={15} className="spin" /> : <ImageIcon size={15} />}
      </button>
      <button
        type="button"
        className="doc-toolbar-btn"
        title="영상 올리기"
        disabled={isUploading}
        onMouseDown={keepSelection}
        onClick={() => pick(videoInputRef)}
      >
        <Film size={15} />
      </button>
      <button
        type="button"
        className="doc-toolbar-btn"
        title="보관함에 있는 파일 첨부"
        onMouseDown={keepSelection}
        onClick={() => onAttachExisting?.()}
      >
        <Paperclip size={15} />
      </button>

      <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handlePicked} />
      <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={handlePicked} />
    </div>
  );
}
