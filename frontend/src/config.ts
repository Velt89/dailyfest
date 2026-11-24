import { bsc } from "viem/chains";

// BNB Chain mainnet
export const CHAIN = bsc; // id 56

// SPACE ID Agent ID registry (ERC-721, non-transferable) — verified live.
// balanceOf(address) > 0 means the address holds an Agent ID.
export const AGENT_ID_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F" as const;

// DEPLOYED — landed exactly at the predicted CREATE2 address.
// Deployed via the deterministic deployment proxy
// 0x4e59b44847b379578588920cA78FbF26c0B4956C with salt
// keccak256("velt.dailyfest.v1"); the deployment landed at precisely the
// simulated address. Creation tx:
// 0x10e7eba36bb1ca86e77b158d2db8c510ff6839d029d88b48e1cea8a8fe4d88dc
// Deployment block: 135529444.
export const DAILYFEST_ADDRESS = "0x01F1AE5E05A1807A0B26123c8a24B087360aC77a" as const;

export const DAILYFEST_DEPLOYED = true;

// Block the DailyFest contract was deployed in (for event scans).
export const DAILYFEST_START_BLOCK = 135529444n;

// The fixed 14-dish menu, in contract order (dishIndex = utcDay % 14).
export const DISHES = [
  { name: "Rendang", slug: "rendang" },
  { name: "Sate Ayam", slug: "sate-ayam" },
  { name: "Nasi Goreng", slug: "nasi-goreng" },
  { name: "Bakso", slug: "bakso" },
  { name: "Martabak Manis", slug: "martabak-manis" },
  { name: "Ramen", slug: "ramen" },
  { name: "Sushi", slug: "sushi" },
  { name: "Tacos", slug: "tacos" },
  { name: "Pizza", slug: "pizza" },
  { name: "Burger", slug: "burger" },
  { name: "Dim Sum", slug: "dim-sum" },
  { name: "BBQ Ribs", slug: "bbq-ribs" },
  { name: "Croissant", slug: "croissant" },
  { name: "Es Krim", slug: "es-krim" },
] as const;

// Feast badge tiers: tier -> required BEST streak.
export const BADGE_TIERS = [
  { tier: 1, name: "Bronze", slug: "badge-bronze", required: 3 },
  { tier: 2, name: "Silver", slug: "badge-silver", required: 7 },
  { tier: 3, name: "Gold", slug: "badge-gold", required: 14 },
] as const;

export function utcDayNow(): number {
  return Math.floor(Date.now() / 1000 / 86400);
}

export function dishIndexForDay(day: number): number {
  return ((day % 14) + 14) % 14;
}

export function dishImage(slug: string): string {
  return `/dishes/${slug}.svg`;
}
