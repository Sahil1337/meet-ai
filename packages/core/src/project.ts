/**
 * A project is the memory boundary: meetings belong to one project, entities
 * are resolved within one project, questions are asked of one project.
 * Multi-tenancy (product spec §43) is a later concern; for the prototype a
 * project is the top of the tree.
 */

import { z } from "zod";
import { Id, IsoDateTime } from "./primitives.ts";

export const Project = z.object({
  id: Id,
  name: z.string().min(1),
  /** Member names as they appear in transcripts. Entity resolution (§32 step 5) matches speakers against these. */
  members: z.array(z.string().min(1)),
  createdAt: IsoDateTime,
});
export type Project = z.infer<typeof Project>;

/** What a caller supplies; the store assigns `id` and `createdAt`. */
export const NewProject = Project.omit({ id: true, createdAt: true });
export type NewProject = z.infer<typeof NewProject>;
