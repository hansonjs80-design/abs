import { splitBodyParts } from '../../lib/schedulerUtils';

export default function BodyPartStack({ parts, className = '' }) {
  const list = Array.isArray(parts)
    ? parts.map((part) => String(part || '').trim()).filter(Boolean)
    : splitBodyParts(parts);

  if (list.length === 0) return '없음';

  return (
    <span className={`body-part-stack${className ? ` ${className}` : ''}`}>
      {list.map((part, index) => (
        <span key={`${part}-${index}`} className="body-part-stack-row">{part}</span>
      ))}
    </span>
  );
}
