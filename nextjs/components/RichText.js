'use client';

// Product descriptions are stored as plain blocks, not HTML, so seller text can never become
// markup. The editor reads blocks out of its DOM and builds that DOM with text nodes only.

import { useEffect, useRef, useState } from 'react';
import { descriptionText, LIMITS } from '@/lib/products';
import { uploadImage } from '@/lib/productsApi';
import { toast } from '@/lib/ui';

const ALIGNMENTS = ['left', 'center', 'right'];

function readBlocks(root) {
  const blocks = [];
  let runs = [];
  let align = '';

  function flush() {
    if (runs.some((run) => run.text.trim())) blocks.push({ type: 'p', ...(align && { align }), runs });
    runs = [];
    align = '';
  }

  function walkNode(node, marks) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) runs.push({ text: node.textContent, ...marks });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'IMG') {
      flush();
      blocks.push({ type: 'img', src: node.getAttribute('src') });
    } else if (tag === 'UL' || tag === 'OL') {
      flush();
      const items = [...node.children].map((item) => {
        const list = [];
        const saved = runs;
        runs = list;
        item.childNodes.forEach((child) => walkNode(child, {}));
        runs = saved;
        return list;
      }).filter((list) => list.some((run) => run.text.trim()));
      if (items.length) blocks.push({ type: tag.toLowerCase(), items });
    } else if (tag === 'BR') {
      flush();
    } else if (tag === 'DIV' || tag === 'P') {
      flush();
      if (ALIGNMENTS.includes(node.style.textAlign)) align = node.style.textAlign;
      node.childNodes.forEach((child) => walkNode(child, marks));
      flush();
    } else {
      const next = { ...marks };
      if (tag === 'B' || tag === 'STRONG') next.b = true;
      if (tag === 'I' || tag === 'EM') next.i = true;
      if (tag === 'U') next.u = true;
      node.childNodes.forEach((child) => walkNode(child, next));
    }
  }

  root.childNodes.forEach((child) => walkNode(child, {}));
  flush();
  return blocks;
}

function runToDom(run) {
  let node = document.createTextNode(run.text);
  ['b', 'i', 'u'].forEach((mark) => {
    if (!run[mark]) return;
    const wrapper = document.createElement(mark);
    wrapper.append(node);
    node = wrapper;
  });
  return node;
}

function writeBlocks(root, blocks) {
  root.replaceChildren(...blocks.map((block) => {
    if (block.type === 'img') {
      const image = document.createElement('img');
      image.src = block.src;
      image.alt = '';
      return image;
    }
    if (block.items) {
      const list = document.createElement(block.type);
      list.append(...block.items.map((runs) => {
        const item = document.createElement('li');
        item.append(...runs.map(runToDom));
        return item;
      }));
      return list;
    }
    const line = document.createElement('div');
    if (block.align) line.style.textAlign = block.align;
    line.append(...block.runs.map(runToDom));
    return line;
  }));
}

function Run({ run }) {
  let node = run.text;
  if (run.u) node = <u>{node}</u>;
  if (run.i) node = <i>{node}</i>;
  if (run.b) node = <b>{node}</b>;
  return node;
}

export function RichText({ blocks }) {
  return (
    <div className="rich-text">
      {blocks.map((block, i) => {
        if (block.type === 'img') return <img src={block.src} alt="" key={i} />;
        if (block.items) {
          const List = block.type;
          return <List key={i}>{block.items.map((runs, j) => <li key={j}>{runs.map((run, k) => <Run run={run} key={k} />)}</li>)}</List>;
        }
        return <p key={i} style={ALIGNMENTS.includes(block.align) ? { textAlign: block.align } : undefined}>{block.runs.map((run, k) => <Run run={run} key={k} />)}</p>;
      })}
    </div>
  );
}

const TOOLS = [
  ['bold', 'B', 'Bold'],
  ['italic', 'I', 'Italic'],
  ['underline', 'U', 'Underline'],
  ['insertUnorderedList', '• List', 'Bulleted list'],
  ['insertOrderedList', '1. List', 'Numbered list'],
  ['justifyLeft', 'Left', 'Align left'],
  ['justifyCenter', 'Centre', 'Align centre'],
  ['justifyRight', 'Right', 'Align right'],
];

export function RichEditor({ id, value, onChange, error }) {
  const editor = useRef(null);
  const selection = useRef(null);
  const [uploading, setUploading] = useState(false);
  const length = descriptionText(value).length;

  useEffect(() => {
    writeBlocks(editor.current, value);
    // Only on mount: after that the editor's DOM is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => onChange(readBlocks(editor.current));

  function run(command) {
    editor.current.focus();
    document.execCommand(command);
    sync();
  }

  function rememberSelection() {
    const current = document.getSelection();
    if (current.rangeCount && editor.current.contains(current.anchorNode)) selection.current = current.getRangeAt(0);
  }

  async function insertImage(file) {
    setUploading(true);
    try {
      const url = await uploadImage(file, { square: false });
      editor.current.focus();
      if (selection.current) {
        const current = document.getSelection();
        current.removeAllRanges();
        current.addRange(selection.current);
      }
      document.execCommand('insertImage', false, url);
      sync();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={`editor ${error ? 'editor--error' : ''}`}>
      <div className="editor__tools" role="toolbar" aria-label="Formatting">
        {TOOLS.map(([command, label, name]) => (
          <button type="button" key={command} aria-label={name} title={name} onMouseDown={(e) => e.preventDefault()} onClick={() => run(command)}>{label}</button>
        ))}
        <label className="editor__image">
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const [file] = e.target.files;
              e.target.value = '';
              if (file) insertImage(file);
            }}
          />
          {uploading ? 'Uploading…' : 'Insert Image'}
        </label>
      </div>
      <div
        className="editor__body"
        id={id}
        ref={editor}
        role="textbox"
        aria-multiline="true"
        aria-label="Product description"
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-count`}
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
        onInput={sync}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          sync();
        }}
      />
      <div className="editor__foot">
        <small className="field__error">{error}</small>
        <small className={length > LIMITS.description ? 'editor__count editor__count--over' : 'editor__count'} id={`${id}-count`}>
          {length.toLocaleString('en-PH')} / {LIMITS.description.toLocaleString('en-PH')}
        </small>
      </div>
    </div>
  );
}
