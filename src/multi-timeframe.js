function direction(signal) {
  return ['UP', 'DOWN'].includes(signal?.side) ? signal.side : null;
}

export function alignMultiTimeframe({ hourly, fifteenMinute, entry } = {}) {
  const entrySide = direction(entry);
  if (!entrySide) return { allowed: false, reason: 'missing_entry_signal', multiplier: 0 };
  const hourlySide = direction(hourly);
  const fifteenSide = direction(fifteenMinute);
  if (hourlySide && hourlySide !== entrySide) {
    return { allowed: false, reason: 'hourly_bias_conflict', multiplier: 0 };
  }
  if (fifteenSide && fifteenSide !== entrySide) {
    return { allowed: false, reason: 'fifteen_minute_confirmation_conflict', multiplier: 0 };
  }
  const aligned = Number(hourlySide === entrySide) + Number(fifteenSide === entrySide);
  return { allowed: true, reason: aligned === 2 ? 'fully_aligned' : 'partially_aligned', multiplier: 1 + aligned * 0.25 };
}
