import BodyPartStack, { normalizeBodyPartStackParts } from './BodyPartStack';

export default function ContextMenuBodySummary({ parts }) {
  const list = normalizeBodyPartStackParts(parts);
  const isStacked = list.length > 1;

  return (
    <span className={`context-menu-body-summary${isStacked ? ' context-menu-body-summary--stacked' : ''}`}>
      <span className="context-menu-body-summary-label">부위 :</span>
      <BodyPartStack parts={list} className="context-menu-body-summary-values" />
    </span>
  );
}
