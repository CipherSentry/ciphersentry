// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  I-R3 — unbonding FIFO, one queue, ≥ 7-day delay                           */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { VerifierRegistry } from "../src/VerifierRegistry.sol";

contract MockCENT {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract UnbondIR3Test is Test {
    MockCENT internal cent;
    VerifierRegistry internal reg;
    address internal oracle = address(0x0B);
    address internal slasher = address(0x5A);
    address internal v = address(0xB1);

    uint256 internal constant BOND = 25_000 ether;
    uint256 internal constant UNBOND_PERIOD = 7 days;

    function setUp() public {
        cent = new MockCENT();
        reg = new VerifierRegistry(address(cent), oracle, slasher);
        cent.mint(v, BOND * 2);
        vm.startPrank(v);
        cent.approve(address(reg), type(uint256).max);
        reg.stake(BOND);
        vm.stopPrank();
    }

    function test_IR3_doubleUnbondReverts() public {
        vm.prank(v);
        reg.requestUnbond();
        vm.prank(v);
        vm.expectRevert();
        reg.requestUnbond();
    }

    function test_IR3_earlyWithdrawReverts() public {
        vm.prank(v);
        reg.requestUnbond();
        vm.prank(v);
        vm.expectRevert();
        reg.withdrawUnbonded();
    }

    function test_IR3_sevenDayGate() public {
        vm.prank(v);
        reg.requestUnbond();
        (, uint64 releasesAt) = reg.queueOf(v);
        assertGe(releasesAt, uint64(block.timestamp + UNBOND_PERIOD - 1));

        vm.warp(block.timestamp + UNBOND_PERIOD);
        uint256 before = cent.balanceOf(v);
        vm.prank(v);
        reg.withdrawUnbonded();
        assertEq(cent.balanceOf(v), before + BOND);
    }
}
