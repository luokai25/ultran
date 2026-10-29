/**
 * Billing adapters.
 *
 * Every provider is reduced to the same two operations: verify a webhook and
 * translate it into a normalized event. Nothing above this module knows which
 * payment processor is in use.
 */

export type BillingEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'payment.succeeded'
  | 'payment.failed';

export interface BillingEvent {
  id: string;
  type: BillingEventType;
  deviceId?: string;
  plan?: string;
  at: number;
  raw: unknown;
}

export interface BillingAdapter {
  readonly name: string;
  /** Verify the provider's signature. Must throw on an invalid payload. */
  verify(rawBody: string, signature: string): unknown;
  /** Normalize a verified payload into a BillingEvent, or null if ignored. */
  normalize(payload: unknown): BillingEvent | null;
}
