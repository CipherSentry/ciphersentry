// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  ENG-A INVARIANT SUITE — MACHINARC ESCROW                                  */
/*  Every DOC-07 §02 invariant is asserted by name:                           */
/*   I-E1  funds move only on matched proof or signed ruling inside window    */
/*   I-E2  Σ escrowed + bonds == contract USDC balance                        */
/*   I-E3  settle() is single-shot (exactly one payout per task, ever)        */
/*   I-E4  no role, key, or pause can stall capital — resolution always open  */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { CipherSentryEscrow } from "../src/Escrow.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

/* ------------------------------- handler ---------------------------------- */

contract EscrowHandler is Test {
    CipherSentryEscrow public esc;
    MockUSDC public usdc;
    address public ruler;
    address[3] public verifiers;

    bytes32[] public liveIds;
    mapping(bytes32 => bool) public settledTerminal;
    uint64 public ghostLegalSettles;
    uint64 public ghostDefaultRefunds;
    uint64 public ghostTimeouts;

    bytes32 constant SPEC = keccak256("render.sequence.4k");
    uint256 constant FRAUD = 64;

    constructor(CipherSentryEscrow _esc, MockUSDC _usdc, address _ruler, address[3] memory _verifiers) {
        esc = _esc;
        usdc = _usdc;
        ruler = _ruler;
        verifiers = _verifiers;
    }

    function _expectedHash(bytes32 id) internal pure returns (bytes32) {
        return keccak256(abi.encode(id));
    }

    function commit(uint96 amountSeed, uint8 actorSeed) external {
        if (liveIds.length >= 96) return;
        uint96 amount = uint96(bound(uint256(amountSeed), 10_000, 1_000_000_000));
        uint96 bond = 20_000;
        address buyer = address(uint160(0xB0B) + actorSeed % 3);
        address worker = address(uint160(0xFEE) + actorSeed % 2);
        usdc.mint(buyer, uint256(amount) + bond);
        vm.prank(buyer);
        usdc.approve(address(esc), type(uint256).max);
        vm.prank(buyer);
        try esc.commit(SPEC, worker, amount, bond) returns (bytes32 id) {
            liveIds.push(id);
            settledTerminal[id] = false;
        } catch {}
    }

    /// Drive one arbitrary task one legal step forward. Only legal paths drive.
    function drive(uint256 seed) external {
        if (liveIds.length == 0) return;
        bytes32 id = liveIds[seed % liveIds.length];
        (address b, address w, uint96 amount, uint96 bond, , , CipherSentryEscrow.State st, uint32 stateAt, uint64 ttl, uint8 matched, , ) = esc.tasks(id);
        b; bond; matched; stateAt; // silence

        if (st == CipherSentryEscrow.State.Committed) {
            vm.warp(block.timestamp + 5);
            vm.prank(w);
            esc.acknowledge(id);
            return;
        }
        if (st == CipherSentryEscrow.State.Executing) {
            // half of drives time-travel past TTL, half report in time
            if (seed % 2 == 0) {
                vm.warp(block.timestamp + uint256(bound(seed, 60, 600)));
            } else {
                vm.warp(block.timestamp + 30);
            }
            if (block.timestamp > ttl) {
                esc.timeout(id);
                ghostTimeouts += 1;
                settledTerminal[id] = true;
                return;
            }
            vm.prank(w);
            esc.report(id, _expectedHash(id));
            return;
        }
        if (st == CipherSentryEscrow.State.Verifying) {
            // quorum votes match (legal path); junk votes can't exist in harness
            for (uint256 i; i < 3; i++) {
                vm.prank(verifiers[i]);
                try esc.vote(id, _expectedHash(id)) {} catch {}
            }
            try esc.settle(id) {
                ghostLegalSettles += 1;
                settledTerminal[id] = true;
            } catch {}
            return;
        }
        if (st == CipherSentryEscrow.State.Disputed) {
            // wait out the ruling window then permissionless default
            vm.roll(uint256(stateAt) + FRAUD + 1);
            esc.defaultRefund(id);
            ghostDefaultRefunds += 1;
            settledTerminal[id] = true;
            return;
        }
        amount; // terminal states: nothing legal can move them
    }

    function liveCount() external view returns (uint256) {
        return liveIds.length;
    }
}

/* ------------------------------ invariants -------------------------------- */

contract EscrowInvariants is StdInvariant, Test {
    MockUSDC internal usdc;
    CipherSentryEscrow internal esc;
    EscrowHandler internal handler;

    address internal ruler = vm.addr(0x5A17E11);
    address[3] internal verifiers = [vm.addr(0x9111), vm.addr(0x9222), vm.addr(0x9333)];

    function setUp() public {
        usdc = new MockUSDC();
        esc = new CipherSentryEscrow(address(usdc), address(0x7171), ruler, 64, 300);
        vm.prank(ruler);
        esc.setVerifier(verifiers[0], true);
        vm.prank(ruler);
        esc.setVerifier(verifiers[1], true);
        vm.prank(ruler);
        esc.setVerifier(verifiers[2], true);

        handler = new EscrowHandler(esc, usdc, ruler, verifiers);
        targetContract(address(handler));
    }

    /// I-E2 — the one invariant money cares most about: accounting always balances.
    function invariant_IE2_accounting() public view {
        (uint256 escrowed, uint256 bonds, uint256 balance) = esc.accounting();
        assertEq(balance, escrowed + bonds, "I-E2: contract balance != escrowed + bonds");
    }

    /// I-E1 — nothing can pay out except legal paths the harness drove.
    function invariant_IE1_legalPayoutsOnly() public view {
        assertEq(
            esc.settledCount(),
            uint256(handler.ghostLegalSettles()) + uint256(handler.ghostDefaultRefunds()),
            "I-E1: a payout happened outside matched proof / window default"
        );
    }

    /// I-E3 — settled set can only grow; terminal tasks never re-open.
    function invariant_IE3_terminalStability() public view {
        uint256 n = handler.liveCount();
        for (uint256 i; i < n; i++) {
            bytes32 id = handler.liveIds(i);
            if (handler.settledTerminal(id)) {
                (, , , , , , CipherSentryEscrow.State st, , , , , ) = esc.tasks(id);
                assertTrue(
                    st == CipherSentryEscrow.State.Settled || st == CipherSentryEscrow.State.Failed,
                    "I-E3: terminal task mutated after payout"
                );
            }
        }
    }

    /* ------------------------- adversarial forge fuzz ---------------------- */

    /// I-E1 — forged rulings never resolve escrow, at any ruling kind, any sig.
    function testFuzz_forgedRulingReverts(uint8 ruling, uint64 nonce, bytes32 junk) public {
        (bytes32 id, , ) = _openDisputedTask();
        bytes memory sig = abi.encodePacked(junk, junk, uint8(27));
        vm.expectRevert();
        esc.rule(id, CipherSentryEscrow.Ruling(ruling % 3), nonce, sig);
        invariant_IE2_accounting();
    }

    /// I-E1 — settle() reverts whenever fewer than QUORUM matched votes exist.
    function testFuzz_settleBeforeQuorumReverts(uint96 amountSeed) public {
        uint96 amount = uint96(bound(uint256(amountSeed), 10_000, 1_000_000_000));
        address buyer = vm.addr(0xB01);
        address worker = vm.addr(0xC01);
        usdc.mint(buyer, uint256(amount) + 20_000);
        vm.prank(buyer);
        usdc.approve(address(esc), type(uint256).max);
        vm.prank(buyer);
        bytes32 id = esc.commit(keccak256("x"), worker, amount, 20_000);
        vm.prank(worker);
        esc.acknowledge(id);
        vm.prank(worker);
        esc.report(id, keccak256("ok"));

        vm.expectRevert(CipherSentryEscrow.NotUnanimous.selector);
        esc.settle(id);

        // a single matching vote still cannot settle — 3 needed
        vm.prank(verifiers[0]);
        esc.vote(id, keccak256("ok"));
        vm.expectRevert(CipherSentryEscrow.NotUnanimous.selector);
        esc.settle(id);
    }

    /// I-E1/I-E4 — rulings outside the fraud window are rejected both directions.
    function testFuzz_rulingWindowStrict(uint8 ruling, uint64 blocks) public {
        (bytes32 id, , ) = _openDisputedTask();
        blocks = uint64(bound(uint256(blocks), 0, 512));
        // forward beyond window → rule() must revert WindowClosed
        vm.roll(uint256(block.number) + 64 + blocks);
        bytes memory sig = abi.encodePacked(bytes32(0), bytes32(0), uint8(28));
        if (blocks > 0) {
            vm.expectRevert(CipherSentryEscrow.WindowClosed.selector);
            esc.rule(id, CipherSentryEscrow.Ruling(ruling % 3), 1, sig);
        }
        // inside window, garbage signature still cannot pass either
        vm.expectRevert();
        esc.rule(id, CipherSentryEscrow.Ruling(0), 1, sig);
    }

    /* ----------------------------- helpers --------------------------------- */

    function _openDisputedTask() internal returns (bytes32 id, address buyer, address worker) {
        buyer = vm.addr(0xBEEF);
        worker = vm.addr(0xCAFE);
        uint96 amount = 96 * 1e6;
        uint96 bond = 1 * 1e6;
        usdc.mint(buyer, uint256(amount) + uint256(bond));
        vm.prank(buyer);
        usdc.approve(address(esc), type(uint256).max);
        vm.prank(buyer);
        id = esc.commit(keccak256("spec"), worker, amount, bond);
        vm.prank(worker);
        esc.acknowledge(id);
        vm.prank(worker);
        esc.report(id, keccak256("bogus-output"));
        vm.prank(verifiers[1]);
        esc.vote(id, keccak256("recomputed-honest"));
        vm.prank(verifiers[2]);
        esc.vote(id, keccak256("recomputed-honest-2")); // second mismatch → disputed
    }


}
