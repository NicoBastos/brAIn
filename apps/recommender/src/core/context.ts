type RawContext = {
  device?: 'mobile' | 'desktop' | 'unknown';
  localTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'late';
  allowSameDomain?: boolean;
  tz?: string;
  now?: Date;
};

type NormalizedContext = {
  device: 'mobile' | 'desktop' | 'unknown';
  localTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'late';
  allowSameDomain?: boolean;
};

/**
 * Normalize/derive request context for scoring.
 *
 * If localTimeOfDay is present it's returned as-is (with device defaulting to 'unknown' if missing).
 * Otherwise compute localTimeOfDay from `now` and `tz` (IANA). Invalid tz falls back to server TZ.
 * We also preserve allowSameDomain if present so downstream steps (diversity) can respect it.
 */
export default function normalizeContext(raw: RawContext = {}): NormalizedContext {
  const device = raw.device ?? 'unknown';
  const allowSameDomain = raw.allowSameDomain;

  if (raw.localTimeOfDay) {
    return { device, localTimeOfDay: raw.localTimeOfDay, allowSameDomain };
  }

  const now = raw.now ?? new Date();
  let hour: number;

  try {
    // Use Intl to compute hour in the provided timezone if available.
    if (raw.tz) {
      const parts = new Intl.DateTimeFormat('en-US', {
        hour12: false,
        hour: 'numeric',
        timeZone: raw.tz,
      }).formatToParts(now);
      const hourPart = parts.find((p) => p.type === 'hour')?.value;
      hour = hourPart ? Number(hourPart) : now.getHours();
    } else {
      hour = now.getHours();
    }
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      hour = now.getHours();
    }
  } catch (e) {
    // Invalid TZ or Intl not supporting requested tz; fallback to server local hour
    hour = now.getHours();
  }

  let localTimeOfDay: NormalizedContext['localTimeOfDay'];
  if (hour >= 5 && hour <= 11) localTimeOfDay = 'morning';
  else if (hour >= 12 && hour <= 16) localTimeOfDay = 'afternoon';
  else if (hour >= 17 && hour <= 21) localTimeOfDay = 'evening';
  else localTimeOfDay = 'late';

  return { device, localTimeOfDay, allowSameDomain };
}

export type { RawContext, NormalizedContext };