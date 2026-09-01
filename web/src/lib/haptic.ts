/** Light haptic feedback where supported (Android/chromium). No-op on iOS Safari. */
export function haptic(pattern: number | number[] = 10) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported — silent */
  }
}
