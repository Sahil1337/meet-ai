/**
 * Scalar building blocks shared by every schema in this package. They are
 * deliberately plain strings and numbers: the database and vector store are
 * not chosen yet, so nothing here may assume a UUID column, a BIGINT, or a
 * Date object. An `Id` is whatever the store hands back, as long as it is a
 * non-empty string.
 */

import { z } from "zod";

/** Opaque identifier assigned by whichever store persists the record. */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Calendar date, `YYYY-MM-DD`. The same shape transcript lines carry. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type IsoDate = z.infer<typeof IsoDate>;

/** Wall-clock time of day at minute precision, `HH:MM`, as transcript lines carry it. */
export const ClockTime = z.string().regex(/^\d{2}:\d{2}$/, "expected HH:MM");
export type ClockTime = z.infer<typeof ClockTime>;

/** Instant in time, ISO 8601 with offset (`2026-09-07T15:02:00Z`). Used for record timestamps. */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Model-reported certainty, 0..1 inclusive. An estimate, never a fact (product spec §31). */
export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;
