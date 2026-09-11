/**
 * The HTTP surface, one entry per endpoint in
 * @meetai/core/src/contracts/api.ts. Handlers are thin: validate the body
 * with the contract's schema, call the container, return the contract's
 * response shape. No business logic here — a handler that grows past ~15
 * lines is doing a unit's job.
 *
 * All handlers throw `NotImplemented` today; index.ts maps that to 501 so
 * the frontend can be pointed at a running server from day one and see
 * exactly which endpoints are missing.
 */

import type { Container } from "./container.ts";

export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`);
    this.name = "NotImplemented";
  }
}

export type Route = {
  method: "GET" | "POST";
  /** `:name` segments become `params[name]`. */
  path: string;
  handle: (ctx: Container, params: Record<string, string>, body: unknown) => Promise<unknown>;
};

export const routes: Route[] = [
  { method: "POST", path: "/projects", handle: async () => { throw new NotImplemented("POST /projects"); } },
  { method: "GET", path: "/projects/:id", handle: async () => { throw new NotImplemented("GET /projects/:id"); } },
  { method: "POST", path: "/projects/:id/meetings", handle: async () => { throw new NotImplemented("POST /projects/:id/meetings"); } },
  { method: "GET", path: "/meetings/:id", handle: async () => { throw new NotImplemented("GET /meetings/:id"); } },
  { method: "GET", path: "/jobs/:id", handle: async () => { throw new NotImplemented("GET /jobs/:id"); } },
  { method: "GET", path: "/projects/:id/commitments", handle: async () => { throw new NotImplemented("GET /projects/:id/commitments"); } },
  { method: "GET", path: "/projects/:id/timeline", handle: async () => { throw new NotImplemented("GET /projects/:id/timeline"); } },
  { method: "GET", path: "/meetings/:id/changes", handle: async () => { throw new NotImplemented("GET /meetings/:id/changes"); } },
  { method: "POST", path: "/projects/:id/ask", handle: async () => { throw new NotImplemented("POST /projects/:id/ask"); } },
];

/** Matches a request path against a route's `:param` pattern. */
export function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const segments = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i]!;
      const s = segments[i]!;
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(s);
      else if (p !== s) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}
