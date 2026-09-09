function parseColorRgb(colorStr) {
  if (!colorStr || typeof colorStr !== 'string') return null;
  const trimmed = colorStr.trim();

  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return [r, g, b];
      }
    }
  }

  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  }

  return null;
}

// Derive the row tint from the visit sequence cell color or prescription label.
export function getPatientHistoryPrescriptionRowColor(prescription, baseColor, isCurrentCell = false) {
  if (baseColor) {
    const rgb = parseColorRgb(baseColor);
    if (rgb) {
      const [r, g, b] = rgb;
      if (isCurrentCell) {
        // 회차 셀 색상 기반으로 산뜻하면서 진하게 강조
        const brightR = Math.min(255, Math.round(r + (255 - r) * 0.10));
        const brightG = Math.min(255, Math.round(g + (255 - g) * 0.10));
        const brightB = Math.min(255, Math.round(b + (255 - b) * 0.10));
        return `rgba(${brightR}, ${brightG}, ${brightB}, 0.88)`;
      }
      // 일반 행: 회차 셀 색상 기반의 은은하고 연한 배경
      return `rgba(${r}, ${g}, ${b}, 0.32)`;
    }
  }

  const label = String(prescription ?? '').trim();
  if (!label) {
    return isCurrentCell ? 'rgba(170, 198, 228, 0.88)' : '#f8fafc';
  }

  let hash = 2166136261;
  for (const character of label) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  }
  const hue = hash % 360;
  const lightness = isCurrentCell ? 76 : 93;
  const saturation = isCurrentCell ? 85 : 70;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
