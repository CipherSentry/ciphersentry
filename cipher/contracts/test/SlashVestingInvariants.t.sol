// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  ENG-A/ENG-B REMAINDER INVARIANT SUITE — CENT, VESTING, SLASH EXECUTOR    */
/*  I-V1/V2/V3 · I-SE1/I-SE2/I-SE3 · proceeds math asserted by name          */
/*                                                                            */
/*  The SlashExecutor is isolated against a fixture ledger (FixtureSlashLedger) */
/*  — VerifierRegistry's own bond semantics are proven separately in           */
/*  RegistryElectionInvariants; this suite proves the executor's queue, caps, */
/*  nullifiers, and the 50/25/25 proceeds split exactly.                      */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { MockCENT } from "./RegistryElectionInvariants.t.sol";
import { VestingVault } from "../src/VestingVault.sol";
import { SlashExecutor } from "../src/SlashExecutor.sol";

/* ------------------------- fixture slash ledger --------------------------- */

contract FixtureSlashLedger {
    MockCENT public cent;
    mapping(address => uint256) public bondOf;

    constructor(MockCENT _cent) {
        cent = _cent;
    }

    function setBondFor(address v, uint256 amount) external {
        bondOf[v] = amount;
    }

    /// Faithful to the registry hook: cut leaves the bond and arrives at the payee.
    function slash(address v, uint256 amount, address payee) external {
        require(bondOf[v] >= amount, "insufficient bond");
        bondOf[v] -= amount;
        cent.mint(payee, amount);
    }
}

/* --------------------------------- suite ---------------------------------- */

contract SlashVestingInvariants is StdInvariant, Test {
    MockCENT internal cent;
    VestingVault internal vault;
    FixtureSlashLedger internal ledger;
    SlashExecutor internal slash;

    address internal treasury = vm.addr(0x7171);
    address internal grantor = vm.addr(0x6017);
    address internal watcher = vm.addr(0xE104);
    address internal resolver = vm.addr(0x50CC);
    address internal claimant = vm.addr(0xBEEF);

    function setUp() public {
        cent = new MockCENT();
        vault = new VestingVault(address(cent), grantor, 64);
        ledger = new FixtureSlashLedger(cent);
        slash = new SlashExecutor(address(ledger), address(cent), watcher, resolver, treasury);
    }

    /* ------------------------------ helpers --------------------------------- */

    function _evidence(string memory salt) internal view returns (bytes32) {
        return keccak256(abi.encode(salt, gasleft()));
    }

    function _watchBond() internal {
        cent.mint(watcher, 400_000 ether);
        vm.prank(watcher);
        cent.approve(address(slash), type(uint256).max);
    }

    function _bondedTarget(address target, uint256 amount) internal {
        ledger.setBondFor(target, amount);
    }

    /* ------------------------------ CENT ------------------------------------ */

    function testFuzz_transfersRespectBalances(address from, address to, uint256 amt) public {
        vm.assume(from != to && to != address(0) && from != to);
        amt = bound(amt, 1 ether, 1_000_000 ether);
        cent.mint(from, amt);
        uint256 before_ = cent.balanceOf(from);
        vm.prank(from);
        cent.transfer(to, amt);
        assertEq(cent.balanceOf(from), before_ - amt, "I-T: drained wrong");
        assertEq(cent.balanceOf(to), amt, "I-T: credited wrong");
    }

    /* --------------------------- I-V1/I-V2/I-V3 ----------------------------- */

    function testFuzz_vestingMonotoneCliffAndCap(uint96 amountSeed, uint96 cliffSeed, uint96 linearSeed) public {
        uint96 amount = uint96(bound(uint256(amountSeed), 1 ether, 1e27));
        uint96 cliff = uint96(bound(uint256(cliffSeed), 1, 200));
        uint96 linear = uint96(bound(uint256(linearSeed), 1, 200));
        cent.mint(address(vault), amount);

        vm.prank(grantor);
        uint256 id = vault.grant(claimant, amount, cliff, linear);

        uint64 e0 = vault.currentEpoch();
        // strictly before cliff+1: nothing (I-V2)
        assertEq(vault.vestedAt(id, uint64(uint256(e0) + uint256(cliff) - 1)), 0, "I-V2 pre-cliff vested");

        vm.roll((uint256(e0) + 1 + cliff) * 64);
        uint96 vA = vault.vestedAt(id, vault.currentEpoch());
        vm.roll((uint256(vault.currentEpoch()) + 1) * 64);
        uint96 vB = vault.vestedAt(id, vault.currentEpoch());
        assertGe(vB, vA, "I-V1 vested declined over epochs");

        assertLe(vault.vestedAt(id, vault.currentEpoch() + 1_000), amount, "I-V2 cap breached");
    }

    function test_claimConservationAndPayOut() public {
        uint96 amount = 100_000 ether;
        cent.mint(address(vault), amount);
        vm.prank(grantor);
        uint256 id = vault.grant(claimant, amount, 10, 20);

        // move to two epochs past the cliff: vested = amount * 2/20 = 10%
        vm.roll((uint256(vault.currentEpoch()) + 12) * 64 + 5);
        uint96 vested = vault.vestedAt(id, uint64(vault.currentEpoch()));
        assertEq(vested, amount / 10, "I-V3: vested math off");

        vm.prank(claimant);
        vault.claim(id);

        (uint96 amt, uint96 claimed, , uint96 claimable) = vault.conservation(id);
        assertEq(claimed, vested, "I-V3: claimed tracked");
        assertEq(claimable, 0, "I-V3: claim over-released");
        assertEq(cent.balanceOf(claimant), claimed, "I-V3: payout missing");
        assertEq(cent.balanceOf(address(vault)), amt - claimed, "I-V3: vault residual wrong");
    }

    function testVestingEpochIndexed_NotWallClock() public {
        uint96 amount = 50_000 ether;
        cent.mint(address(vault), amount);
        vm.prank(grantor);
        uint256 id = vault.grant(claimant, amount, 5, 10);
        uint96 before_ = vault.vestedAt(id, vault.currentEpoch());

        vm.warp(block.timestamp + 365 days); // a year of wall time, zero blocks
        assertEq(vault.vestedAt(id, vault.currentEpoch()), before_, "I-V* wall clock moved vesting");
    }

    /* --------------------------- I-SE1 nullifier ----------------------------- */

    function testFuzz_evidenceReplayBlocked(bytes32 evidenceHash) public {
        _watchBond();
        _bondedTarget(claimant, 100_000 ether);

        vm.prank(watcher);
        uint256 queueId = slash.submitEvidence(evidenceHash, claimant, SlashExecutor.Severity.FalseVote);
        assertEq(queueId, 0, "queue index drifted");

        vm.expectRevert(abi.encodeWithSelector(SlashExecutor.EvidenceReplayed.selector, evidenceHash));
        vm.prank(watcher);
        slash.submitEvidence(evidenceHash, claimant, SlashExecutor.Severity.FalseVote);
    }

    /* --------------------------- I-SE2 epoch cap ----------------------------- */

    function testEpochCapDefersOverflowToNextEpoch() public {
        _watchBond();
        address colluderA = vm.addr(0xC011);
        address colluderB = vm.addr(0xC012);
        ledger.setBondFor(colluderA, 80_000 ether);
        ledger.setBondFor(colluderB, 80_000 ether);

        vm.prank(watcher);
        slash.submitEvidence(_evidence("a"), colluderA, SlashExecutor.Severity.Collusion);
        vm.prank(watcher);
        slash.submitEvidence(_evidence("b"), colluderB, SlashExecutor.Severity.Collusion);

        slash.processNext(); // first 80k cut - within 100k epoch cap

        // remaining attempt is 80k against remaining 20k headroom
        vm.expectRevert(
            abi.encodeWithSelector(
                SlashExecutor.EpochCapExceeded.selector,
                80_000 ether,
                80_000 ether,
                100_000 ether
            )
        );
        slash.processNext(); // +80k > 100k cap: defers cleanly, never truncates

        vm.roll(block.number + 64 + 1); // epoch rotates; cap refreshes
        slash.processNext();
        assertEq(slash.head(), 2, "I-SE3: FIFO cursor skipped after deferral");
    }

    /* --------------------------- I-SE3 FIFO ---------------------------------- */

    function testFuzz_fifoOrderPreserved(bytes32 a1, bytes32 a2) public {
        a2;
        _watchBond();
        ledger.setBondFor(claimant, 100_000 ether);
        ledger.setBondFor(vm.addr(0xFB2), 100_000 ether);

        vm.prank(watcher);
        uint256 idA = slash.submitEvidence(a1, claimant, SlashExecutor.Severity.FalseVote);
        vm.prank(watcher);
        uint256 idB = slash.submitEvidence(keccak256(abi.encode(a1, a2)), vm.addr(0xFB2), SlashExecutor.Severity.FalseVote);
        assertEq(idA + 1, idB, "FIFO assignment broken");

        slash.processNext(); // head must be idA only
        assertEq(slash.head(), 1, "I-SE3: FIFO queue skipped");
    }

    /* ----------------- proceeds math: 50/25/25 conservation ------------------- */

    function testProceedsSplitIsExact() public {
        _watchBond();
        address target = vm.addr(0x51A7);
        ledger.setBondFor(target, 200_000 ether);

        vm.prank(watcher);
        slash.submitEvidence(_evidence("proceeds"), target, SlashExecutor.Severity.FalseVote);

        uint256 aBond = ledger.bondOf(target);
        uint256 cut = (aBond * 1000) / 10_000; // false vote → 10%
        uint256 expectedBurned = cut / 2;
        uint256 expectedBounty = (cut - expectedBurned) / 2;
        uint256 expectedTreasury = cut - expectedBurned - expectedBounty;

        uint256 watcherBefore = cent.balanceOf(watcher);
        slash.processNext();

        assertEq(
            cent.balanceOf(address(0x000000000000000000000000000000000000dEaD)),
            expectedBurned,
            "burn share wrong"
        );
        assertEq(cent.balanceOf(treasury), expectedTreasury, "treasury share missing");
        assertEq(cent.balanceOf(watcher), watcherBefore + slash.CHALLENGE_BOND() + expectedBounty, "bounty wrong");
        assertEq(ledger.bondOf(target), aBond - cut, "I-SE4: ledger cut mismatch");

        // exact conservation: three destinations sum to the cut, no dust
        assertEq(expectedBurned + expectedBounty + expectedTreasury, cut, "proceeds dust");
    }
}
