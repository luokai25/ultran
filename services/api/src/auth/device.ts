/**
 * Device identity and entitlement signing.
 *
 * A device registers once, proves possession of its key, and thereafter
 * receives short-lived session tokens. Entitlements are signed with the
 * server key so the client can verify them offline.
 */

export interface DeviceRegistration {
  deviceId: string;
  /** Base64 public key generated locally; the private key never leaves the device. */
  publicKey: string;
  platform: 'ios' | 'android' | 'web' | 'desktop';
}

export interface Session {
  deviceId: string;
  token: string;
  expiresAt: number;
}

/**
 * Register a device and return a challenge to be signed.
 *
 * TODO: persist the public key, issue a nonce, verify the signed response,
 * then mint a session token.
 */
export async function registerDevice(
  reg: DeviceRegistration,
): Promise<{ deviceId: string; challenge: string }> {
  return {
    deviceId: reg.deviceId,
    challenge: crypto.randomUUID(),
  };
}
