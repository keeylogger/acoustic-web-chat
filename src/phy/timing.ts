/** One byte on the air. Guards are inside the 100 ms frame. */
export const PREAMBLE_SEC = 0.02;
export const GUARD_SEC = 0.01;
export const NIBBLE_SEC = 0.03;

export const HIGH_START = PREAMBLE_SEC + GUARD_SEC;
export const LOW_START = HIGH_START + NIBBLE_SEC + GUARD_SEC;
export const FRAME_PERIOD = LOW_START + NIBBLE_SEC;

export const TUKEY_ALPHA = 0.2;

/** 16 ms analysis window ends this far before the acoustic preamble ends. */
export const PEAK_TO_PREAMBLE_END_SEC = 0.002;
/** Center of the high nibble, measured from the acoustic end of the preamble. */
export const HIGH_CENTER_AFTER_PREAMBLE_SEC = 0.025;
/** Center of the low nibble, measured from the acoustic end of the preamble. */
export const LOW_CENTER_AFTER_PREAMBLE_SEC = 0.065;
/** Re-arm the preamble search this long after the preamble ends. */
export const COOLDOWN_AFTER_PREAMBLE_SEC = 0.074;
