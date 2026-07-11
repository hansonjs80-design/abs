import BodyPartStack from './BodyPartStack';

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
      {text.split('\n').map((line, index) => {
        const bodyPartPrefix = '🦴 부위: ';
        if (line.startsWith(bodyPartPrefix)) {
          return (
            <div key={index} className="sw-custom-tooltip-body-line">
              <span className="sw-custom-tooltip-body-label">🦴 부위:</span>
              <BodyPartStack
                parts={line.slice(bodyPartPrefix.length)}
                className="sw-custom-tooltip-body-values"
              />
            </div>
          );
        }

        return (
          <div key={index} className={index === 0 ? 'sw-custom-tooltip-time' : undefined}>
            {index === 0 && line.startsWith('⏱') ? (
              <>
                <span className="sw-custom-tooltip-clock">⏱</span>
                {line.slice(1)}
              </>
            ) : line}
          </div>
        );
      })}
    </div>
  );
}
