import {specializedToolPresentation} from '../specialized-tool-content';
import '../styles/specialized-tool-content.css';
export {hasSpecializedToolContent, specializedToolLabel, specializedToolSummary} from '../specialized-tool-content';

export interface SpecializedToolContentProps {
  toolName: string;
  phase: 'input' | 'output';
  text: string;
  offset?: number;
  status?: string;
  isError?: boolean;
}

/** Inner content only. Shared MessageBody owns disclosure, paging and revocation. */
export default function SpecializedToolContent(props: SpecializedToolContentProps) {
  const view = specializedToolPresentation(props);
  if (!view) return null;
  return <div className={`specialized-tool-content specialized-tool-content--${view.kind}`}>
    {view.fields.length > 0 && <dl className="specialized-tool-fields">{view.fields.map(field => <div key={field.label}>
      <dt>{field.label}</dt><dd>{field.value}</dd>
    </div>)}</dl>}
    {view.text !== undefined && <pre className="tool-content specialized-tool-text" tabIndex={0}><code>{view.text}</code></pre>}
  </div>;
}
