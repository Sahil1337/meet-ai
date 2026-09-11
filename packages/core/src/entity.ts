/**
 * Entities are the things propositions are *about*, resolved across meetings:
 * "Rahul", "Rahul Patel" and "@rahul" become one person; "the payment API"
 * and "payment integration" become one task (product spec §32 step 5, §24).
 * A proposition is text; an entity is an identity that state can attach to.
 *
 * Resolution is conservative by policy: when confidence is low, do not merge
 * (§32 step 5). That policy lives in `@meetai/memory`; the shape lives here.
 */

import { z } from "zod";
import { Id, IsoDateTime } from "./primitives.ts";

export const EntityKind = z.enum(["person", "task", "decision", "topic"]);
export type EntityKind = z.infer<typeof EntityKind>;

export const Entity = z.object({
  id: Id,
  projectId: Id,
  kind: EntityKind,
  /** Canonical display name. */
  name: z.string().min(1),
  /** Other surface forms that resolved to this entity. */
  aliases: z.array(z.string().min(1)),
  /** The proposition that first introduced the entity. */
  createdFrom: Id,
  createdAt: IsoDateTime,
});
export type Entity = z.infer<typeof Entity>;

export const NewEntity = Entity.omit({ id: true, createdAt: true });
export type NewEntity = z.infer<typeof NewEntity>;

/** How a proposition refers to an entity. `owner` is the person responsible; `subject` is what the claim is about. */
export const MentionRole = z.enum(["subject", "owner", "mentioned"]);
export type MentionRole = z.infer<typeof MentionRole>;

/** The proposition ↔ entity link (spine: Claim → Entity). */
export const Mention = z.object({
  propositionId: Id,
  entityId: Id,
  role: MentionRole,
});
export type Mention = z.infer<typeof Mention>;
