/**
 * Notification dispatch — in-app rows are persisted to the Notification table;
 * email / SMS / push are stubbed and only log. Phase 8+ will wire real
 * providers (Postmark, Twilio, APNs/FCM). Calling sites use `dispatch()` which
 * fans out to whichever channels make sense for the kind.
 *
 * `data` payload shape is per-kind; keep it loose-typed here so adding new
 * kinds doesn't require touching the dispatcher.
 */
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";

export type NotificationKind =
  | "invitation_received"
  | "invitation_accepted"
  | "ownership_offer";

export type DispatchTargets = {
  /** Persist a Notification row for this user (in-app delivery). */
  userId?: string;
  /** Send a (stubbed) email to this address. */
  email?: string | null;
  /** Send a (stubbed) SMS to this phone number. */
  phone?: string | null;
};

export type DispatchInput = {
  kind: NotificationKind;
  data: Record<string, unknown>;
  /** Where to deliver. Channels without a target are skipped. */
  to: DispatchTargets;
  /** Human-readable subject; logged + used by the email stub. */
  subject: string;
  /** Human-readable body; logged + used by the email/sms stubs. */
  body: string;
};

export async function dispatch(input: DispatchInput, log: FastifyBaseLogger): Promise<void> {
  const { kind, data, to, subject, body } = input;

  if (to.userId) {
    try {
      await prisma.notification.create({
        data: { userId: to.userId, kind, data: data as object },
      });
    } catch (err) {
      log.warn({ err, kind, userId: to.userId }, "notification persistence failed");
    }
  }

  if (to.email) {
    log.info({ kind, to: to.email, subject }, `[email-stub] ${body}`);
  }
  if (to.phone) {
    log.info({ kind, to: to.phone }, `[sms-stub] ${body}`);
  }
  if (to.userId) {
    // Push dispatcher is a no-op until APNs/FCM creds land.
    log.info({ kind, userId: to.userId }, "[push-stub] would push notification");
  }
}
