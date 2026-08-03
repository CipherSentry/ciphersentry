// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  SlashExecutor ↔ real VerifierRegistry + CentToken (I-SE4 live ledger)     */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { CentToken } from "../src/CENT.sol";
import { VerifierRegistry } from "../src/VerifierRegistry.sol";
import { SlashExecutor } from "../src/SlashExecutor.sol";

contract SlashRegistryIntegrationTest is Test {
    CentToken internal cent;
    VerifierRegistry internal reg;
    SlashExecutor internal slash;

    address internal treasury = address(0x7EA);
    address internal oracle = address(0x0B);
    address internal watcher;
    address internal resolver = address(0x5E);
    address internal target;

    uint256 internal constant BOND = 25_000 ether;
    uint256 internal constant CHALLENGE_BOND = 2_500 ether;

    function setUp() public {
        watcher = address(this);
        target = address(0x7A);

        cent = new CentToken(address(this));

        // CREATE prediction: registry then election-less slash at nonce+1
        uint64 slashNonce = uint64(vm.getNonce(address(this)) + 1);
        address expectedSlash = vm.computeCreateAddress(address(this), slashNonce);

        reg = new VerifierRegistry(address(cent), oracle, expectedSlash);
        slash = new SlashExecutor(address(reg), address(cent), watcher, resolver, treasury);
        require(address(slash) == expectedSlash, "slash addr drift");

        // fund + stake target
        cent.transfer(target, BOND);
        vm.startPrank(target);
        cent.approve(address(reg), type(uint256).max);
        reg.stake(BOND);
        vm.stopPrank();

        // watcher bond for challenge
        cent.approve(address(slash), type(uint256).max);
    }

    function test_ISE4_processNext_cutsRegistryBond() public {
        uint256 beforeBond = reg.bondOf(target);
        assertEq(beforeBond, BOND);

        bytes32 evidence = keccak256("e2e-false-vote");
        uint256 id = slash.submitEvidence(evidence, target, SlashExecutor.Severity.FalseVote);
        assertEq(id, 0);
        assertEq(slash.challengeCount(), 1);

        uint256 graveBefore = cent.balanceOf(address(0xdead));
        slash.processNext();

        uint256 afterBond = reg.bondOf(target);
        // FalseVote = 10% of bond
        uint256 cut = (BOND * 1000) / 10_000;
        assertEq(afterBond, beforeBond - cut);
        // 50% of cut burned to graveyard
        assertEq(cent.balanceOf(address(0xdead)), graveBefore + cut / 2);
        // I-R1 still holds on registry
        (uint256 bonded, uint256 queued, uint256 bal) = reg.accounting();
        assertEq(bal, bonded + queued);
        assertEq(slash.challengeCount(), 0);
    }

    function test_ISE1_nullifierBlocksReplay() public {
        bytes32 evidence = keccak256("once-only");
        slash.submitEvidence(evidence, target, SlashExecutor.Severity.FalseVote);
        vm.expectRevert(abi.encodeWithSelector(SlashExecutor.EvidenceReplayed.selector, evidence));
        slash.submitEvidence(evidence, target, SlashExecutor.Severity.FalseVote);
    }

    function test_ISE3_fifoOrder() public {
        address t2 = address(0x72);
        cent.transfer(t2, BOND);
        vm.startPrank(t2);
        cent.approve(address(reg), type(uint256).max);
        reg.stake(BOND);
        vm.stopPrank();

        slash.submitEvidence(keccak256("a"), target, SlashExecutor.Severity.FalseVote);
        slash.submitEvidence(keccak256("b"), t2, SlashExecutor.Severity.FalseVote);
        assertEq(slash.challengeCount(), 2);

        slash.processNext(); // head = target
        assertEq(reg.bondOf(target), BOND - (BOND * 1000) / 10_000);
        assertEq(reg.bondOf(t2), BOND);

        slash.processNext(); // then t2
        assertEq(reg.bondOf(t2), BOND - (BOND * 1000) / 10_000);
        assertEq(slash.challengeCount(), 0);
    }
}
