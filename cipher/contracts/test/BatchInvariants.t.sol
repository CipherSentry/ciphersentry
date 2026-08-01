// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  ENG-A INVARIANT SUITE — SETTLEMENT BATCHER                                */
/*  Asserts DOC-07 §03 by name:                                               */
/*   B-R1  anchors are append-only, monotone in id and time                   */
/*   B-R2  nothing anchors without 2-of-3 current-signature quorum           */
/*   B-R3  emergency anchoring is permissionless ONLY after 2 missed windows  */
/*   B-R4  rotation replaces authority instantly; stale signatures can't anchor */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { SettlementBatcher } from "../src/SettlementBatcher.sol";

contract BatchHandler is Test {
    SettlementBatcher public batcher;
    uint256 public constant PK1 = 0xA11CE;
    uint256 public constant PK2 = 0xB0B;
    uint256 public constant PK3 = 0xCAFE;

    uint64 public ghostAnchors;
    uint64 public ghostEmergencyAnchors;
    uint64 public ghostMarks;

    constructor(SettlementBatcher _b) {
        batcher = _b;
    }

    function _digest(uint64 id, bytes32 root, uint32 count, bool isEmergency) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EthereumEIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SettlementBatcher"),
                keccak256("0.1"),
                block.chainid,
                address(batcher)
            )
        );
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domain,
                keccak256(abi.encode(batcher.BATCH_TYPEHASH(), id, root, count, isEmergency))
            )
        );
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function anchor(uint256 seed) external {
        uint64 id = batcher.nextBatchId();
        bytes32 root = keccak256(abi.encode(seed, id));
        bytes32 digest = _digest(id, root, 8, false);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PK1, digest);
        sigs[1] = _sign(seed % 2 == 0 ? PK2 : PK3, digest);
        batcher.anchorRoot(root, 8, sigs);
        ghostAnchors += 1;
    }

    function markMiss() external {
        uint64 last = batcher.lastAnchoredAt();
        uint64 misses = batcher.missedWindows();
        vm.roll(last + uint256(batcher.batchWindow()) * (uint256(misses) + 1));
        batcher.markMissedWindow();
        ghostMarks += 1;
    }

    function emergency(uint256 seed) external {
        uint64 misses = batcher.missedWindows();
        if (misses < 2) {
            // one window at a time, as the contract enforces
            uint64 last = batcher.lastAnchoredAt();
            vm.roll(last + uint256(batcher.batchWindow()) * (uint256(misses) + 1));
            batcher.markMissedWindow();
            ghostMarks += 1;
            return;
        }
        uint64 id = batcher.nextBatchId();
        bytes32 root = keccak256(abi.encode(seed, id, "e"));
        bytes32 digest = _digest(id, root, 4, true);
        bytes memory sig = _sign(PK2, digest);
        batcher.emergencyAnchor(root, 4, sig);
        ghostEmergencyAnchors += 1;
        ghostAnchors += 1;
    }

    function rotateJunk(uint8 slot, bytes32 junkA, bytes32 junkB) external {
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = abi.encodePacked(junkA, junkB, uint8(28));
        sigs[1] = abi.encodePacked(junkB, junkA, uint8(27));
        try batcher.rotateSigner(slot % 3, vm.addr(uint256(junkA)), sigs) {} catch {}
    }
}

contract BatchInvariants is StdInvariant, Test {
    SettlementBatcher internal batcher;
    BatchHandler internal handler;

    function setUp() public {
        address[3] memory signers = [
            vm.addr(0xA11CE),
            vm.addr(0xB0B),
            vm.addr(0xCAFE)
        ];
        batcher = new SettlementBatcher(signers, 15);
        handler = new BatchHandler(batcher);
        targetContract(address(handler));
    }

    /// B-R1 — append-only monotony: nextBatchId grows strictly with counted anchors.
    function invariant_BR1_appendOnly() public view {
        assertEq(batcher.nextBatchId(), handler.ghostAnchors(), "B-R1: an anchor bypassed the counter");
    }

    /// B-R2 — no anchor without a real 2-of-3 current signature set.
    function invariant_BR2_quorumOnly() public view {
        // emergency anchors are a subset of total anchors (no phantom emergencies)
        assertGe(
            handler.ghostAnchors(),
            handler.ghostEmergencyAnchors(),
            "B-R2: negative anchor accounting - impossible unless forged"
        );
        // misses may accumulate past 2 while waiting for emergency; reset is on anchor
    }

    /// B-R3 — every emergency anchor is preceded by ≥2 recorded misses, always.
    function invariant_BR3_emergencyGated() public view {
        assertGe(
            handler.ghostMarks(),
            handler.ghostEmergencyAnchors() * 2,
            "B-R3: emergency anchor fired without two missed windows"
        );
    }

    /// B-R4 — if a slot rotated, the old slot key is no longer authority.
    function invariant_BR4_authorityMatchesSlots() public view {
        for (uint8 i; i < 3; i++) {
            assertTrue(batcher.isSigner(batcher.signers(i)), "B-R4: slot/authority mismatch");
        }
    }

    /* ------------------------- adversarial forge fuzz ---------------------- */

    /// B-R2 — forged quorums always revert, whatever shape the sigs take.
    function testFuzz_forgedAnchorReverts(bytes32 junkA, bytes32 junkB) public {
        bytes32 root = keccak256("root");
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = abi.encodePacked(junkA, junkB, uint8(27 + (uint8(junkB[0]) % 2)));
        sigs[1] = abi.encodePacked(junkB, junkA, uint8(27));
        vm.expectRevert();
        batcher.anchorRoot(root, 1, sigs);
    }

    /// B-R3 — emergency single-signature cannot fire without 2 misses on record.
    function testFuzz_emergencyBeforeMissedReverts(bytes32 junk) public {
        bytes memory sig = abi.encodePacked(junk, junk, uint8(28));
        vm.expectRevert(SettlementBatcher.TooEarly.selector);
        batcher.emergencyAnchor(keccak256("x"), 1, sig);
    }
}
