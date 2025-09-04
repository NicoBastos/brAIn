import getPrisma from '@brain/db';
import type { ContentResultType } from '../../../../types/schemas/variants/result/Content.result';
import type { ReadingTimeBucket } from '../../../../types/schemas/enums/ReadingTimeBucket.schema';
import type { EventType } from '../../../../types/schemas/enums/EventType.schema';

export type Candidate = {
  id: string;
  domain: string;
  savedAt: Date;
  readingBucket?: ReadingTimeBucket;
  themeIds?: string[];
  neverOpened: boolean;
  isFreshForgotten: boolean;
  isFrequentSource: boolean;
  isBridge?: boolean;
};

/**
 * Fetch an efficient candidate pool for a user and precompute simple booleans used by the scorer.
 *
 * For the scaffold we perform a few simple queries and merge in memory.
 */
export async function getCandidates(opts: {
  userId: string;
  poolLimit?: number;
  includeOpenedFallback?: boolean;
}): Promise<Candidate[]> {
  const prisma = getPrisma();
  const poolLimit = opts.poolLimit ?? 500;
  const userId = opts.userId;

  const rawContents = await prisma.content.findMany({
    where: { userId },
    orderBy: { savedAt: 'desc' },
    take: poolLimit,
    include: { ContentFeature: true, ThemeItem: true },
  });

  // Use the generated types from `types` to assert a stricter shape for downstream logic.
  const contents = (rawContents as unknown) as ContentResultType[];

  if (!contents || contents.length === 0) return [];

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  const domainStats = await prisma.userDomainStat.findMany({
    where: { userId },
    orderBy: { saveCount: 'desc' },
    take: 50,
  });
  const domainSaveMap = new Map<string, number>();
  for (const ds of domainStats) domainSaveMap.set(ds.domain, ds.saveCount);

  const ABS_MIN = 3;

  const candidates: Candidate[] = [];
  for (const c of contents) {
    const openCount = await prisma.event.count({
      where: { contentId: c.id, userId, type: 'OPEN' as EventType },
    });

    const neverOpened = openCount === 0;
    const isFreshForgotten =
      neverOpened && c.savedAt >= tenDaysAgo && c.savedAt <= threeDaysAgo;

    const domain = c.domain ?? 'unknown';
    const saveCount = domainSaveMap.get(domain) ?? 0;
    const userTopThreshold =
      domainStats.length > 0
        ? domainStats[Math.max(0, Math.floor(domainStats.length * 0.1) - 1)]?.saveCount ?? ABS_MIN
        : ABS_MIN;
    const isFrequentSource = saveCount >= Math.max(userTopThreshold || 0, ABS_MIN);

    // ThemeItem in generated schema is typed as unknown[], so coerce safely here:
    const themeIds = Array.isArray(c.ThemeItem)
      ? (c.ThemeItem.map((t: any) => (t && (t.themeId as string)) ).filter(Boolean) as string[])
      : [];

    // ContentFeature in schema is an array; pick the first feature (if present) for readingBucket.
    const readingBucket =
      Array.isArray(c.ContentFeature) && c.ContentFeature.length > 0
        ? ((c.ContentFeature[0] as any).readingBucket as
            | 'SHORT'
            | 'MEDIUM'
            | 'LONG'
            | 'XLONG'
            | undefined)
        : undefined;

    candidates.push({
      id: c.id,
      domain,
      savedAt: c.savedAt,
      readingBucket,
      themeIds,
      neverOpened,
      isFreshForgotten,
      isFrequentSource,
      isBridge: (themeIds?.length ?? 0) > 1,
    });
  }

  return candidates;
}

export default getCandidates;