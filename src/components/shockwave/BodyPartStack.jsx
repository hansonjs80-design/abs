import { splitBodyParts } from '../../lib/schedulerUtils';

export function normalizeBodyPartStackParts(parts) {
  return Array.isArray(parts)
    ? parts.map((part) => String(part || '').trim()).filter(Boolean)
    : splitBodyParts(parts);
}

export default function BodyPartStack({ parts, className = '', showMarkers = false }) {
  const list = normalizeBodyPartStackParts(parts);
  const hasMarkers = showMarkers && list.length > 1;

  if (list.length === 0) return '없음';

  return (
    <span className={`body-part-stack${hasMarkers ? ' body-part-stack--markers' : ''}${className ? ` ${className}` : ''}`}>
      {list.map((part, index) => (
        <span key={`${part}-${index}`} className="body-part-stack-row">
          {hasMarkers ? <span className="body-part-stack-marker">•</span> : null}
          <span className="body-part-stack-text">{part}</span>
        </span>
      ))}
    </span>
  );
}
