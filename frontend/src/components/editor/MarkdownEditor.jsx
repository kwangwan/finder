import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Bold, 
  Italic, 
  Strikethrough, 
  Heading1, 
  Heading2, 
  Heading3, 
  Code, 
  Quote, 
  List, 
  ListOrdered, 
  CheckSquare, 
  Table, 
  Link, 
  Columns, 
  Eye, 
  Edit3, 
  Save, 
  Download, 
  Star, 
  Trash2, 
  ArrowLeft,
  Paperclip,
  Video,
  Image as ImageIcon,
  Loader2,
  FileText
} from 'lucide-react';
import InsertFileModal from './InsertFileModal';
import { uploadNoteImage } from '../../api';
import { useDialog } from '../../context/DialogContext';
import { exportMarkdownToPdf } from '../../utils/pdfExport';
import { createMarkdownLinkComponents } from '../../utils/markdownLinkComponents';

export default function MarkdownEditor({
  file,
  activeWorkspaceId,
  onSave,
  onBack,
  onDelete,
  onToggleFavorite,
  onNavigateFolder
}) {
  const { showAlert } = useDialog();
  const [title, setTitle] = useState(file?.name || '제목 없는 문서');
  const [content, setContent] = useState(file?.content || '');
  const [tags, setTags] = useState(file?.tags || []);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved'
  const [viewMode, setViewMode] = useState('split'); // 'split' | 'edit' | 'preview'
  const [isInsertModalOpen, setIsInsertModalOpen] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  
  const textareaRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const imageInputRef = useRef(null);

  useEffect(() => {
    if (file) {
      setTitle(file.name);
      setContent(file.content || '');
      setTags(file.tags || []);
      setSaveStatus('saved');
    }
  }, [file?.id]);

  const triggerAutoSave = (newTitle, newContent, newTags) => {
    setSaveStatus('unsaved');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await onSave({
          name: newTitle,
          content: newContent,
          tags: newTags
        });
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('unsaved');
        console.error('Auto-save error:', err);
      }
    }, 1000);
  };

  const handleTitleChange = (e) => {
    const val = e.target.value;
    setTitle(val);
    triggerAutoSave(val, content, tags);
  };

  const handleContentChange = (e) => {
    const val = e.target.value;
    setContent(val);
    triggerAutoSave(title, val, tags);
  };

  const insertFormatting = (before, after = '', defaultText = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end) || defaultText;
    const newText = content.substring(0, start) + before + selectedText + after + content.substring(end);

    setContent(newText);
    triggerAutoSave(title, newText, tags);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length);
    }, 0);
  };

  const handleUploadImageFile = async (imgFile) => {
    if (!imgFile) return;
    setIsUploadingImage(true);
    try {
      const res = await uploadNoteImage(imgFile, activeWorkspaceId, file?.folder_id);
      const imgMarkdown = `\n![${imgFile.name}](${res.previewUrl})\n`;
      insertFormatting(imgMarkdown, '', '');
    } catch (err) {
      await showAlert({
        title: '이미지 업로드 실패',
        message: '이미지를 업로드하지 못했습니다: ' + err.message,
        type: 'error'
      });
    } finally {
      setIsUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          e.preventDefault();
          const ext = blob.type.split('/')[1] || 'png';
          const fileObj = new File([blob], `image_${Date.now()}.${ext}`, { type: blob.type });
          await handleUploadImageFile(fileObj);
          return;
        }
      }
    }
  };

  const handleDrop = async (e) => {
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const dropped = e.dataTransfer.files[0];
      if (dropped && dropped.type.startsWith('image/')) {
        e.preventDefault();
        e.stopPropagation();
        await handleUploadImageFile(dropped);
      }
    }
  };

  const handleInsertFromModal = (snippet) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      const newText = content + snippet;
      setContent(newText);
      triggerAutoSave(title, newText, tags);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = content.substring(0, start) + snippet + content.substring(end);
    setContent(newText);
    triggerAutoSave(title, newText, tags);
  };

  const handleExportMarkdown = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
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
      await exportMarkdownToPdf(title, content);
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

  // Custom Markdown Component Renderers (folder links, presigned downloads, YouTube embeds)
  const customMarkdownComponents = createMarkdownLinkComponents({ onNavigateFolder, showAlert });

  return (
    <div className="editor-layout">
      {/* 1. Top Header Actions */}
      <div className="editor-header" style={{ padding: '0.65rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <button className="btn-icon" onClick={onBack} title="목록으로 돌아가기">
            <ArrowLeft size={18} />
          </button>
          
          <span style={{ 
            fontSize: '0.75rem', 
            color: saveStatus === 'saved' ? 'var(--accent-emerald)' : 'var(--accent-amber)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem'
          }}>
            {saveStatus === 'saved' ? '● 자동 저장됨' : (saveStatus === 'saving' ? '⟳ 저장 중...' : '○ 미저장')}
          </span>

          {isUploadingImage && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Loader2 size={13} className="spin" /> 이미지 업로드 중...
            </span>
          )}
        </div>

        {/* Action controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
            <button 
              className={`btn-icon ${viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => setViewMode('edit')}
              title="에디터만 보기"
              style={{ background: viewMode === 'edit' ? 'var(--bg-card-hover)' : 'transparent' }}
            >
              <Edit3 size={15} />
            </button>
            <button 
              className={`btn-icon ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
              title="스플릿 뷰"
              style={{ background: viewMode === 'split' ? 'var(--bg-card-hover)' : 'transparent' }}
            >
              <Columns size={15} />
            </button>
            <button 
              className={`btn-icon ${viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setViewMode('preview')}
              title="미리보기만"
              style={{ background: viewMode === 'preview' ? 'var(--bg-card-hover)' : 'transparent' }}
            >
              <Eye size={15} />
            </button>
          </div>

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

      {/* Formatting Toolbar */}
      {viewMode !== 'preview' && (
        <div className="editor-toolbar">
          <button className="toolbar-btn" onClick={() => insertFormatting('# ', '', '제목 1')} title="Heading 1">
            <Heading1 size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('## ', '', '제목 2')} title="Heading 2">
            <Heading2 size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('### ', '', '제목 3')} title="Heading 3">
            <Heading3 size={15} />
          </button>
          <div className="toolbar-divider" />
          
          <button className="toolbar-btn" onClick={() => insertFormatting('**', '**', '굵은 글씨')} title="볼드체">
            <Bold size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('*', '*', '기울임')} title="이탤릭">
            <Italic size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('~~', '~~', '취소선')} title="취소선">
            <Strikethrough size={15} />
          </button>
          <div className="toolbar-divider" />

          <button className="toolbar-btn" onClick={() => insertFormatting('`', '`', '인라인 코드')} title="코드">
            <Code size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('```javascript\n', '\n```', '// 코드')} title="코드 블록">
            {"{ }"}
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('> ', '', '인용구')} title="인용문">
            <Quote size={15} />
          </button>
          <div className="toolbar-divider" />

          <button className="toolbar-btn" onClick={() => insertFormatting('- ', '', '항목')} title="불릿 목록">
            <List size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('1. ', '', '항목')} title="숫자 목록">
            <ListOrdered size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('- [ ] ', '', '할 일')} title="체크리스트">
            <CheckSquare size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('| 제목 | 설명 |\n| --- | --- |\n| 항목1 | 내용1 |\n', '')} title="표">
            <Table size={15} />
          </button>
          <button className="toolbar-btn" onClick={() => insertFormatting('[', '](https://example.com)', '링크 텍스트')} title="일반 링크">
            <Link size={15} />
          </button>

          <div className="toolbar-divider" />

          {/* Direct Image Upload Button */}
          <input 
            type="file" 
            ref={imageInputRef} 
            accept="image/*" 
            style={{ display: 'none' }} 
            onChange={e => {
              if (e.target.files && e.target.files[0]) {
                handleUploadImageFile(e.target.files[0]);
              }
            }}
          />
          <button 
            className="toolbar-btn" 
            onClick={() => imageInputRef.current?.click()} 
            title="이미지 업로드 및 삽입 (클립보드 붙여넣기/드래그 지원)"
            style={{ color: 'var(--accent-emerald)', fontWeight: 600, gap: 4 }}
            disabled={isUploadingImage}
          >
            <ImageIcon size={14} />
            <span>이미지 삽입</span>
          </button>

          {/* Attachments Toolbar Buttons */}
          <button 
            className="toolbar-btn" 
            onClick={() => setIsInsertModalOpen(true)} 
            title="기존 저장된 파일 첨부 / 유튜브 동영상 임베드"
            style={{ color: 'var(--accent-primary)', fontWeight: 600, gap: 4 }}
          >
            <Paperclip size={14} />
            <span>파일/영상 첨부</span>
          </button>
        </div>
      )}

      {/* Editor & Preview Panes */}
      <div className="editor-panes">
        {(viewMode === 'split' || viewMode === 'edit') && (
          <div className="editor-pane-raw">
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={content}
              onChange={handleContentChange}
              onPaste={handlePaste}
              onDrop={handleDrop}
              placeholder="마크다운 문법으로 지식을 자유롭게 기록하세요... (이미지 붙여넣기 및 드래그 지원)"
              spellCheck="false"
            />
          </div>
        )}

        {(viewMode === 'split' || viewMode === 'preview') && (
          <div className="editor-pane-preview">
            <div className="markdown-body">
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={customMarkdownComponents}
              >
                {content || '*작성된 내용이 없습니다. 왼쪽 에디터에서 내용을 입력하세요.*'}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Insert File / YouTube Modal */}
      <InsertFileModal
        isOpen={isInsertModalOpen}
        onClose={() => setIsInsertModalOpen(false)}
        onInsertMarkdown={handleInsertFromModal}
      />
    </div>
  );
}
