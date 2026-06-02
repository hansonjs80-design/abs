const KOREAN_QWERTY_KEY_MAP = {
  'ㅂ': 'q',
  'ㅃ': 'q',
  'ㅈ': 'w',
  'ㅉ': 'w',
  'ㄷ': 'e',
  'ㄸ': 'e',
  'ㄱ': 'r',
  'ㄲ': 'r',
  'ㅅ': 't',
  'ㅆ': 't',
  'ㅛ': 'y',
  'ㅕ': 'u',
  'ㅑ': 'i',
  'ㅐ': 'o',
  'ㅒ': 'o',
  'ㅔ': 'p',
  'ㅖ': 'p',
  'ㅁ': 'a',
  'ㄴ': 's',
  'ㅇ': 'd',
  'ㄹ': 'f',
  'ㅎ': 'g',
  'ㅗ': 'h',
  'ㅓ': 'j',
  'ㅏ': 'k',
  'ㅣ': 'l',
  'ㅋ': 'z',
  'ㅌ': 'x',
  'ㅊ': 'c',
  'ㅍ': 'v',
  'ㅠ': 'b',
  'ㅜ': 'n',
  'ㅡ': 'm',
};

export function convertKoreanQwertyMistypeToEnglish(value) {
  return Array.from(String(value || '').toLowerCase())
    .map((char) => KOREAN_QWERTY_KEY_MAP[char] || char)
    .join('');
}
