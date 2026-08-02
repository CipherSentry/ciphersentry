/**
 * Seed agent stake (s_i) — mirrors gateway REGISTRY + verifier bond floor.
 * Trust formula term #0: 50·log2(1 + s_i). Without stake, scores flatten.
 */

/** USDC stake at risk for known agents (gateway REGISTRY parity). */
export const AGENT_SEED_STAKES: Readonly<Record<string, number>> = {
  "agent:vector-7": 2600,
  "agent:atlas-01": 12000,
  "agent:helix-3": 3100,
  "agent:probe-9": 600,
  "agent:orbit-2": 700,
  "agent:forge-11": 850,
};

/** CENT bond floor for known foundation verifiers (B1 seats). */
export const VERIFIER_SEED_BONDS: Readonly<Record<string, number>> = {
  "vrf:gamma-1": 40_000,
  "vrf:delta-4": 35_000,
  "vrf:sigma-2": 30_000,
};

/** s_i for agent_id — registry stake, else verifier bond, else 0. */
export function seedStake(agentId: string): number {
  if (AGENT_SEED_STAKES[agentId] != null) return AGENT_SEED_STAKES[agentId]!;
  if (VERIFIER_SEED_BONDS[agentId] != null) return VERIFIER_SEED_BONDS[agentId]!;
  return 0;
}
