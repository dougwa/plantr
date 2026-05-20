/**
 * Plan limits — currently only FREE exists. Enforce these wherever billing
 * caps come into play (site creation, plant creation on a site).
 */
import { Plan } from "@prisma/client";

export type PlanLimits = {
  /** Max sites a user may own (excluding ones they're only a member of). */
  ownedSites: number;
  /** Max plants per site, evaluated against the site Owner's plan. */
  plantsPerSite: number;
};

const LIMITS: Record<Plan, PlanLimits> = {
  FREE: { ownedSites: 1, plantsPerSite: 50 },
};

export function planLimits(plan: Plan): PlanLimits {
  return LIMITS[plan];
}
