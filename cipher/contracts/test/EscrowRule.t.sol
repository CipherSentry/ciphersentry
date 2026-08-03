// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  Escrow.rule happy paths — EIP-712 Refund / Release / Split                */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { CipherSentryEscrow } from "../src/Escrow.sol";
import { MockUSDC } from "./mocks/MockUSDC.sol";

contract EscrowRuleTest is Test {
    MockUSDC internal usdc;
    CipherSentryEscrow internal esc;

    uint256 internal rulerPk = 0xA11CE;
    address internal ruler;
    address internal buyer = address(0xB0B);
    address internal worker = address(0xFEE);
    address internal v1 = address(0xB01);
    address internal v2 = address(0xB02);

    bytes32 internal constant SPEC = keccak256("render.sequence.4k");
    uint256 internal constant FRAUD = 64;
    uint256 internal constant TTL = 300;

    function setUp() public {
        ruler = vm.addr(rulerPk);
        usdc = new MockUSDC();
        esc = new CipherSentryEscrow(address(usdc), address(0x7EA), ruler, FRAUD, TTL);

        vm.prank(ruler);
        esc.setVerifier(v1, true);
        vm.prank(ruler);
        esc.setVerifier(v2, true);

        usdc.mint(buyer, 1_000_000e6);
        vm.prank(buyer);
        usdc.approve(address(esc), type(uint256).max);
    }

    function _commit() internal returns (bytes32 id) {
        vm.prank(buyer);
        id = esc.commit(SPEC, worker, 100e6, 10_000);
    }

    function _toDisputed(bytes32 id, bytes32 reported) internal {
        vm.prank(worker);
        esc.acknowledge(id);
        vm.prank(worker);
        esc.report(id, reported);
        bytes32 dissent = keccak256("dissent");
        vm.prank(v1);
        esc.vote(id, dissent);
        vm.prank(v2);
        esc.vote(id, dissent);
        (,,,,,, CipherSentryEscrow.State st,,,,,) = esc.tasks(id);
        assertEq(uint8(st), uint8(CipherSentryEscrow.State.Disputed));
    }

    function _signRule(bytes32 taskId, CipherSentryEscrow.Ruling ruling, uint64 nonce)
        internal
        view
        returns (bytes memory sig)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                esc.domainSeparator(),
                keccak256(abi.encode(esc.RULING_TYPEHASH(), taskId, uint8(ruling), nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(rulerPk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function test_rule_refund() public {
        bytes32 id = _commit();
        _toDisputed(id, keccak256("bad"));
        uint256 buyerBefore = usdc.balanceOf(buyer);
        bytes memory sig = _signRule(id, CipherSentryEscrow.Ruling.Refund, 1);
        esc.rule(id, CipherSentryEscrow.Ruling.Refund, 1, sig);
        (,,,,,, CipherSentryEscrow.State st,,,,,) = esc.tasks(id);
        assertEq(uint8(st), uint8(CipherSentryEscrow.State.Settled));
        // buyer gets amount + bond back
        assertEq(usdc.balanceOf(buyer), buyerBefore + 100e6 + 10_000);
    }

    function test_rule_release() public {
        bytes32 id = _commit();
        _toDisputed(id, keccak256("bad"));
        uint256 workerBefore = usdc.balanceOf(worker);
        bytes memory sig = _signRule(id, CipherSentryEscrow.Ruling.Release, 1);
        esc.rule(id, CipherSentryEscrow.Ruling.Release, 1, sig);
        (,,,,,, CipherSentryEscrow.State st,,,,,) = esc.tasks(id);
        assertEq(uint8(st), uint8(CipherSentryEscrow.State.Settled));
        // worker receives amount - 0.35% fee
        uint96 fee = uint96((uint256(100e6) * 35) / 10_000);
        assertEq(usdc.balanceOf(worker), workerBefore + 100e6 - fee);
    }

    function test_rule_split() public {
        bytes32 id = _commit();
        _toDisputed(id, keccak256("bad"));
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 workerBefore = usdc.balanceOf(worker);
        bytes memory sig = _signRule(id, CipherSentryEscrow.Ruling.Split, 1);
        esc.rule(id, CipherSentryEscrow.Ruling.Split, 1, sig);
        (,,,,,, CipherSentryEscrow.State st,,,,,) = esc.tasks(id);
        assertEq(uint8(st), uint8(CipherSentryEscrow.State.Settled));
        // buyer: half amount + bond; worker: other half - fee
        assertGt(usdc.balanceOf(buyer), buyerBefore);
        assertGt(usdc.balanceOf(worker), workerBefore);
    }

    function test_rule_badSig_reverts() public {
        bytes32 id = _commit();
        _toDisputed(id, keccak256("bad"));
        bytes memory junk = new bytes(65);
        vm.expectRevert();
        esc.rule(id, CipherSentryEscrow.Ruling.Refund, 1, junk);
    }

    function test_rule_notDisputed_reverts() public {
        bytes32 id = _commit();
        bytes memory sig = _signRule(id, CipherSentryEscrow.Ruling.Refund, 1);
        vm.expectRevert();
        esc.rule(id, CipherSentryEscrow.Ruling.Refund, 1, sig);
    }

    function test_rule_staleNonce_reverts() public {
        bytes32 id = _commit();
        _toDisputed(id, keccak256("bad"));
        bytes memory sig1 = _signRule(id, CipherSentryEscrow.Ruling.Refund, 1);
        esc.rule(id, CipherSentryEscrow.Ruling.Refund, 1, sig1);
        // second rule on Settled reverts (not Disputed)
        bytes memory sig2 = _signRule(id, CipherSentryEscrow.Ruling.Release, 2);
        vm.expectRevert();
        esc.rule(id, CipherSentryEscrow.Ruling.Release, 2, sig2);
    }
}
