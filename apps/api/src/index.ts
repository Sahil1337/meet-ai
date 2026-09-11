/**
 * Process entry: build the container, serve the routes. Bun's built-in
 * server is enough for nine JSON endpoints; add a framework only if a real
 * need appears (middleware for auth, say), and justify it in
 * docs/architecture.md.
 */

import type { ErrorResponse } from "@meetai/core";
import { createContainer } from "./container.ts";
import { matchRoute, NotImplemented } from "./routes.ts";

const container = createContainer();

function error(status: number, code: string, message: string): Response {
  const body: ErrorResponse = { error: { code, message } };
  return Response.json(body, { status });
}

Bun.serve({
  port: container.config.port,
  async fetch(req) {
    const url = new URL(req.url);
    const match = matchRoute(req.method, url.pathname);
    if (!match) return error(404, "not_found", `${req.method} ${url.pathname}`);
    try {
      const body = req.method === "POST" ? await req.json().catch(() => null) : undefined;
      const result = await match.route.handle(container, match.params, body);
      return Response.json(result);
    } catch (err) {
      if (err instanceof NotImplemented) return error(501, "not_implemented", err.message);
      if (err instanceof Error && err.name === "ZodError") return error(400, "invalid_request", err.message);
      return error(500, "internal", err instanceof Error ? err.message : String(err));
    }
  },
});

console.log(`@meetai/api listening on :${container.config.port}`);
