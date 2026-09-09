function colorToRgba(colorStr, alpha) {
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
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
  }

  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const hslMatch = trimmed.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hslMatch) {
    const [, h, s] = hslMatch;
    const alphaLightness = isNaN(alpha) ? 93 : Math.max(70, Math.round(96 - alpha * 45));
    return `hsl(${h}, ${s}%, ${alphaLightness}%)`;
  }

  return null;
}

// Derive the tint from the prescription text color or label so sorting and filtering never change it.
export function getPatientHistoryPrescriptionRowColor(prescription, prescriptionColor, isCurrentCell = false) {
  const normalAlpha = 0.14;
  const currentAlpha = 0.32;
  const alpha = isCurrentCell ? currentAlpha : normalAlpha;

  if (prescriptionColor) {
    const rgba = colorToRgba(prescriptionColor, alpha);
    if (rgba) return rgba;
  }

  const label = String(prescription ?? '').trim();
  if (!label) {
    return isCurrentCell ? 'rgba(226, 232, 240, 0.9)' : '#f8fafc';
  }

  let hash = 2166136261;
  for (const character of label) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  }
  const hue = hash % 360;
  const lightness = isCurrentCell ? 82 : 93;
  const saturation = isCurrentCell ? 75 : 70;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
