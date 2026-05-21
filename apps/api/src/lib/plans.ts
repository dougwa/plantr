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

const UNLIMITED: PlanLimits = {
  ownedSites: Number.POSITIVE_INFINITY,
  plantsPerSite: Number.POSITIVE_INFINITY,
};

// App creators bypass plan caps. Emails are stored lowercased.
const FOUNDER_EMAILS: ReadonlySet<string> = new Set([
  "liuwalter99@gmail.com",
  "dougwa@gmail.com",
]);

export function planLimitsFor(user: {
  plan: Plan;
  email: string | null;
}): PlanLimits {
  if (user.email && FOUNDER_EMAILS.has(user.email.toLowerCase())) {
    return UNLIMITED;
  }
  return LIMITS[user.plan];
}

export function planLimits(plan: Plan): PlanLimits {
  return LIMITS[plan];
}
