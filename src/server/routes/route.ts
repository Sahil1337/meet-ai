import type { Request } from 'express';
import { Router } from 'express';
import type { AppContext } from '../app.js';
import { firstUpstreamRequest } from '../core/completion.js';
import { estimatePromptTokens, lastUserText, parseChatRequest, type ChatRequest } from '../core/mapping.js';
import { decideMode, requestedMode, type RouteDecision } from '../core/router.js';
import { asyncHandler } from '../middleware.js';
import { estimateTokens } from '../util/tokens.js';

/**
 * Dry runs. Both take the same body as /v1/chat/completions and never generate:
 *  - POST /v1/route    the adaptive router decision
 *  - POST /v1/inspect  the decision plus the exact first payload that would go to Ollama
 */
export function routeRouter(ctx: AppContext): Router {
  const router = Router();

  async function routeRequest(req: Request): Promise<{ body: ChatRequest; decision: RouteDecision }> {
    const body = parseChatRequest(req.body);
    const decision = await ctx.queue.run(() => decideMode(body, ctx.config, ctx.classify));
    return { body, decision };
  }

  router.post(
    '/inspect',
    asyncHandler(async (req, res) => {
      const { body, decision } = await routeRequest(req);
      const { plan, request } = firstUpstreamRequest(body, ctx.config, decision);
      res.setHeader('x-meetiq-mode', decision.mode);
      const upstreamPromptEstimate = estimateTokens(
        JSON.stringify(request.messages) + JSON.stringify(request.tools ?? ''),
      );
      res.json({
        router: decision,
        mode_used: plan.modeUsed,
        buffered_streaming: plan.buffered,
        tool_path: plan.forcedChoice ? 'forced' : plan.union ? 'union' : plan.activeTools ? 'native' : 'none',
        estimated_prompt_tokens: upstreamPromptEstimate,
        upstream_request: request,
      });
    }),
  );

  router.post(
    '/route',
    asyncHandler(async (req, res) => {
      const { body, decision } = await routeRequest(req);
      res.setHeader('x-meetiq-mode', decision.mode);
      res.json({
        ...decision,
        mode_requested: requestedMode(body) ?? null,
        default_mode: ctx.config.DEFAULT_MODE,
        estimated_prompt_tokens: estimatePromptTokens(body),
        last_user_tokens: estimateTokens(lastUserText(body.messages)),
      });
    }),
  );
  return router;
}
