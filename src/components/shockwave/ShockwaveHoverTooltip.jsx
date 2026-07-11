import BodyPartStack, { normalizeBodyPartStackParts } from './BodyPartStack';

function TooltipListBlock({ icon, label, items }) {
  return (
    <div className="sw-custom-tooltip-list-block">
      <div className="sw-custom-tooltip-list-heading">
        <span className="sw-custom-tooltip-list-icon">{icon}</span>
        <span className="sw-custom-tooltip-list-label">{label}</span>
      </div>
      <div className="sw-custom-tooltip-list-items">
        {items.map((item, index) => (
          <div key={`${item}-${index}`} className="sw-custom-tooltip-list-row">
            <span className="sw-custom-tooltip-list-marker">•</span>
            <span className="sw-custom-tooltip-list-text">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TooltipBodyPartLine({ value }) {
  const parts = normalizeBodyPartStackParts(value);

  if (parts.length <= 1) {
    return (
      <div className="sw-custom-tooltip-body-line">
        <span className="sw-custom-tooltip-body-label">🦴 부위:</span>
        <BodyPartStack
          parts={parts}
          className="sw-custom-tooltip-body-values"
        />
      </div>
    );
  }

  return (
    <TooltipListBlock
      icon="🦴"
      label="부위:"
      items={parts}
    />
  );
}

export default function ShockwaveHoverTooltip({ tooltipRef, text, visible }) {
  if (!visible || !text) return null;

  return (
    <div
      ref={tooltipRef}
      className="sw-custom-tooltip"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        opacity: 0,
      }}
    >
      {(() => {
        const lines = text.split('\n');
        const renderedLines = [];

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const bodyPartPrefix = '🦴 부위: ';
          if (line.startsWith(bodyPartPrefix)) {
            renderedLines.push(
              <TooltipBodyPartLine
                key={index}
                value={line.slice(bodyPartPrefix.length)}
              />
            );
            continue;
          }

          if (line === '📝 메모:') {
            const memoItems = [];
            let nextIndex = index + 1;
            while (nextIndex < lines.length && lines[nextIndex].trim().startsWith('•')) {
              memoItems.push(lines[nextIndex].trim().replace(/^•\s*/, ''));
              nextIndex += 1;
            }

            if (memoItems.length > 0) {
              renderedLines.push(
                <TooltipListBlock
                  key={index}
                  icon="📝"
                  label="메모:"
                  items={memoItems}
                />
              );
              index = nextIndex - 1;
              continue;
            }
          }

          renderedLines.push(
            <div key={index} className={index === 0 ? 'sw-custom-tooltip-time' : undefined}>
              {index === 0 && line.startsWith('⏱') ? (
                <>
                  <span className="sw-custom-tooltip-clock">⏱</span>
                  {line.slice(1)}
                </>
              ) : line}
            </div>
          );
        }

        return renderedLines;
      })()}
    </div>
  );
}
