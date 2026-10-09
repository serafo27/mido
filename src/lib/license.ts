// Mido Pro's license (src-tauri/src/license.rs): bought once from Polar,
// activated on this computer, checked with Polar now and then.
import { invoke } from "@tauri-apps/api/core";

export interface LicenseStatus {
  /** Mido Pro is on sale (released builds don't offer it until the store opens). */
  available: boolean;
  active: boolean;
  /** The key, mostly hidden. */
  key: string | null;
  email: string | null;
  /** Why it stopped working, if it did. */
  problem: string | null;
  /** The customer's purchases page: their key, and the computers it's on. */
  portal: string | null;
  /** Where to buy it. */
  checkout: string | null;
}

/** Where the license stands, after checking with Polar if it's been a while. */
export const checkLicense = () => invoke<LicenseStatus>("license_check");
export const activateLicense = (key: string) => invoke<LicenseStatus>("license_activate", { key });
/** Frees this computer's place on the license. */
export const deactivateLicense = () => invoke<LicenseStatus>("license_deactivate");
