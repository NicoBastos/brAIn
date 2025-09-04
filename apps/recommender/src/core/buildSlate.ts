import getCandidates from './candidates';
import scoreItem, { type ScoreResult } from './scorer';
import applyDiversity, { type Scored } from './diversity';
import type { NormalizedContext } from './context';
import type { Candidate } from './candidates';
import getPrisma from '@brain/db';
import type { EventType } from '../../../../types/schemas/enums/EventType.schema';
import { z } from 'zod';
import { SlateItemResultSchema } from '../../../../types/schemas/variants/result/SlateItem.result';

export type BuildSlateParams = {
  userId: string;
  k: number;
  context: NormalizedContext;
};

// derive the item shape from generated SlateItem result schema for strictness
const BuildSlateItemSchema = SlateItemResultSchema.pick({
  contentId: true,
  score: true,
  reasons: true,
});
export type BuildSlateItem = z.infer<typeof BuildSlateItemSchema>;

export type BuildSlateResult = {
  slateId: string;
  items: BuildSlateItem[];
};

/**
 * Orchestrate recommendation: get candidates → score → diversify → persist slate → log impressions.
 *
 * This implementation:
 * - limits candidate pool to 500
 * - scores every candidate using scorer
 * - sorts by score desc
 * - applies diversity to pick top-k
 * - writes Slate + SlateItem rows and IMPRESSION events in a transaction
 * - retries once on transient DB error
 */
export default async function buildSlate(params: BuildSlateParams): Promise<BuildSlateResult> {
  const prisma = getPrisma();
  const pool: Candidate[] = await getCandidates({ userId: params.userId, poolLimit: 500 });

  if (!pool || pool.length === 0) {
    // Create an empty slate for analytics
    const slate = await prisma.slate.create({
      data: { userId: params.userId, meta: { empty: true } },
    });
    return { slateId: slate.id, items: [] };
  }

  // Score candidates
  const scored: Scored[] = pool.map((c) => {
    const { score, reasons }: ScoreResult = scoreItem(c, {
      device: params.context.device,
      localTimeOfDay: params.context.localTimeOfDay,
    });
    return { ...c, score, reasons };
  });

  // Sort by score desc then savedAt desc
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.savedAt.getTime() < b.savedAt.getTime() ? 1 : -1;
  });

  // Apply diversity
  const selected: Scored[] = applyDiversity(scored, {
    k: params.k,
    allowSameDomain: params.context?.allowSameDomain ?? false,
    requireShortIfAvailable: true,
    minDistinctThemes: 2,
  });

  // Persist slate and items in a transaction
  const persist = async () => {
    return await prisma.$transaction(async (tx: ReturnType<typeof getPrisma>) => {
      const slate = await tx.slate.create({
        data: {
          userId: params.userId,
          meta: { weightsVersion: 1, context: params.context },
        },
      });

      // Batch insert slate items
      const itemsCreate = selected.map((it, idx) => ({
        slateId: slate.id,
        position: idx + 1,
        contentId: it.id,
        score: it.score,
        reasons: it.reasons,
      }));
      // Prisma can't create multiple rows for a model via createMany with composite PK referencing connected records easily in some setups,
      // but createMany is suitable here.
      await tx.slateItem.createMany({
        data: itemsCreate.map((i) => ({
          slateId: i.slateId,
          position: i.position,
          contentId: i.contentId,
          score: i.score,
          reasons: i.reasons,
        })),
      });

      // Log impressions
      for (const it of selected) {
        await tx.event.create({
          data: {
            userId: params.userId,
            contentId: it.id,
            slateId: slate.id,
            type: 'IMPRESSION' as EventType,
            context: { reasons: it.reasons },
          },
        });
      }

      return { slateId: slate.id, items: selected.map((s) => ({ contentId: s.id, score: s.score, reasons: s.reasons })) };
    });
  };

  try {
    return await persist();
  } catch (err) {
    // Simple single retry
    try {
      return await persist();
    } catch (e) {
      throw e;
    }
  }
}