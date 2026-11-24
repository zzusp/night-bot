import {codeLanguage, highlightedCode} from './PiPresentation';
import type {EditDiffRow} from '../edit-diff';

export function EditDiff({rows, path, applied}: {rows: EditDiffRow[]; path?: string; applied: boolean}) {
  const language = codeLanguage(path);
  const hasLineNumbers = rows.some(row => row.line !== undefined);
  const width = rows.reduce((max, row) => Math.max(max, row.line === undefined ? 0 : String(row.line).length), 0);
  return <pre className="tool-content pi-web-edit-diff" tabIndex={0} aria-label={applied ? '已应用的文件修改' : '请求修改预览'}>
    <code style={{gridTemplateColumns: `${hasLineNumbers ? width + 1 : 0}ch 2ch minmax(max-content, 1fr)`}}>{rows.map((row, index) =>
      <span key={index} className={`pi-edit-row is-${row.kind}`}>
        <span className="pi-edit-line" data-line={row.line}>{row.line}</span>
        <span className="pi-edit-marker">{row.kind === 'removed' ? '-' : row.kind === 'added' ? '+' : ''}</span>
        <span className="pi-edit-code">{highlightedCode(row.text, language)}{index < rows.length - 1 ? '\n' : ''}</span>
      </span>)}</code>
  </pre>;
}
