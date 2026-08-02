/**
 * Off-chain Verifier Registry — B2.
 *
 * Mirrors VerifierRegistry.sol seat rules without chain:
 *   BOND_FLOOR = 25_000 CENT · Bonded | Unbonding | Jailed
 * External verifiers stake via gateway `stake`; foundation seats are seeded.
 */

export type VerifierStatus = "None" | "Bonded" | "Unbonding" | "Jailed";

export interface VerifierSeat {
  id: string;
  bond: number;
  accuracyBps: number; // 0..10_000
  status: VerifierStatus;
  external: boolean;
  joinedAt: number;
}

export const BOND_FLOOR = 25_000;
export const DEFAULT_ACCURACY_BPS = 9_800;

/** Foundation seats — always present so an election can form on cold start. */
export const FOUNDATION_SEATS: ReadonlyArray<{ id: string; bond: number; accuracyBps: number }> = [
  { id: "vrf:gamma-1", bond: 40_000, accuracyBps: 9_900 },
  { id: "vrf:delta-4", bond: 35_000, accuracyBps: 9_700 },
  { id: "vrf:sigma-2", bond: 30_000, accuracyBps: 9_800 },
];

export class BondRegistry {
  private seats = new Map<string, VerifierSeat>();

  constructor(seedFoundation = true) {
    if (seedFoundation) {
      for (const f of FOUNDATION_SEATS) {
        this.seats.set(f.id, {
          id: f.id,
          bond: f.bond,
          accuracyBps: f.accuracyBps,
          status: "Bonded",
          external: false,
          joinedAt: 0,
        });
      }
    }
  }

  get(id: string): VerifierSeat | undefined {
    return this.seats.get(id);
  }

  all(): VerifierSeat[] {
    return [...this.seats.values()];
  }

  eligible(): VerifierSeat[] {
    return this.all().filter((s) => s.status === "Bonded" && s.bond >= BOND_FLOOR);
  }

  /** First stake or top-up. External seat if new. */
  stake(id: string, amount: number, opts?: { accuracyBps?: number }): VerifierSeat {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("stake amount must be > 0");
    const cur = this.seats.get(id);
    if (cur?.status === "Jailed") throw new Error(`verifier ${id} is jailed`);
    if (cur?.status === "Unbonding") throw new Error(`verifier ${id} is unbonding`);

    if (!cur) {
      if (amount < BOND_FLOOR) throw new Error(`minimum bond is ${BOND_FLOOR} CENT`);
      const seat: VerifierSeat = {
        id,
        bond: amount,
        accuracyBps: opts?.accuracyBps ?? DEFAULT_ACCURACY_BPS,
        status: "Bonded",
        external: true,
        joinedAt: Date.now(),
      };
      this.seats.set(id, seat);
      return seat;
    }

    cur.bond += amount;
    if (opts?.accuracyBps !== undefined) cur.accuracyBps = opts.accuracyBps;
    cur.status = "Bonded";
    return cur;
  }

  setAccuracy(id: string, bps: number): void {
    const s = this.seats.get(id);
    if (!s) throw new Error(`unknown verifier ${id}`);
    if (bps < 0 || bps > 10_000) throw new Error("accuracy bps out of range");
    s.accuracyBps = bps;
  }

  requestUnbond(id: string): VerifierSeat {
    const s = this.seats.get(id);
    if (!s || s.status !== "Bonded") throw new Error(`cannot unbond ${id}`);
    s.status = "Unbonding";
    return s;
  }

  /**
   * Apply a slash cut. Jails when remaining bond falls under floor.
   * Returns remaining bond.
   */
  slash(id: string, amount: number): { remaining: number; jailed: boolean; cut: number } {
    const s = this.seats.get(id);
    if (!s) throw new Error(`unknown verifier ${id}`);
    const cut = Math.min(amount, s.bond);
    s.bond -= cut;
    let jailed = false;
    if (s.bond < BOND_FLOOR && s.status === "Bonded") {
      s.status = "Jailed";
      jailed = true;
    }
    return { remaining: s.bond, jailed, cut };
  }

  unjail(id: string): VerifierSeat {
    const s = this.seats.get(id);
    if (!s) throw new Error(`unknown verifier ${id}`);
    if (s.bond < BOND_FLOOR) throw new Error("bond under floor");
    s.status = "Bonded";
    return s;
  }

  bondOf(id: string): number {
    return this.seats.get(id)?.bond ?? 0;
  }
}
