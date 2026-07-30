export function isWindowsPlatform(navigatorLike = (
  typeof navigator !== 'undefined' ? navigator : null
)) {
  const platformSignature = [
    navigatorLike?.userAgentData?.platform,
    navigatorLike?.platform,
    navigatorLike?.userAgent,
  ].filter(Boolean).join(' ');

  return /windows|win32|win64|wow64/i.test(platformSignature);
}
