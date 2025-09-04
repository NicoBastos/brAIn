import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import buildSlate, { type BuildSlateResult } from '../core/buildSlate';
import normalizeContext, { type NormalizedContext } from '../core/context';

const RecommendRequestSchema = z.object({
  userId: z.string().min(1),
  k: z.number().int().positive().optional(),
  context: z
    .object({
      device: z.union([z.literal('mobile'), z.literal('desktop'), z.literal('unknown')]).optional(),
      localTimeOfDay: z
        .union([z.literal('morning'), z.literal('afternoon'), z.literal('evening'), z.literal('late')])
        .optional(),
      allowSameDomain: z.boolean().optional(),
      tz: z.string().optional(),
    })
    .optional(),
});

type RecommendRequest = z.infer<typeof RecommendRequestSchema>;

export default async function recommendRoutes(fastify: FastifyInstance) {
  fastify.post('/recommend', async (request: FastifyRequest<{ Body: RecommendRequest }>, reply: FastifyReply) => {
    // Parse & validate body (defensive)
    const parse = RecommendRequestSchema.safeParse(request.body ?? {});
    if (!parse.success) {
      const issues = parse.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply.status(400).send({ error: 'ValidationError', issues });
    }
    const req = parse.data as RecommendRequest;

    // Normalize inputs
    const k = Math.min(req.k ?? 10, 50);
    const ctx: NormalizedContext = normalizeContext(req.context ?? {});

    try {
      const res: BuildSlateResult = await buildSlate({
        userId: req.userId,
        k,
        context: ctx,
      });
      return reply.status(200).send(res);
    } catch (err) {
      // Unexpected errors
      fastify.log.error({ err }, 'buildSlate failed');
      return reply.status(500).send({ error: 'InternalError', message: (err as Error).message || 'unknown' });
    }
  });
}