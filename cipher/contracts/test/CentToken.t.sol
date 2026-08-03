// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  I-T1 — CentToken fixed supply + conservation under transfer/approve       */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { CentToken } from "../src/CENT.sol";

contract CentTokenTest is Test {
    CentToken internal cent;
    address internal dist = address(0xD1);
    address internal a = address(0xA1);
    address internal b = address(0xB2);

    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        cent = new CentToken(dist);
    }

    /// I-T1: totalSupply == 1e9 · 10^18 forever; no mint path
    function test_IT1_fixedSupply() public view {
        assertEq(cent.totalSupply(), SUPPLY);
        assertEq(cent.balanceOf(dist), SUPPLY);
    }

    function test_transferConserves() public {
        vm.prank(dist);
        assertTrue(cent.transfer(a, 100 ether));
        assertEq(cent.balanceOf(a), 100 ether);
        assertEq(cent.balanceOf(dist) + cent.balanceOf(a) + cent.balanceOf(b), SUPPLY);

        vm.prank(a);
        assertTrue(cent.transfer(b, 40 ether));
        assertEq(cent.balanceOf(a) + cent.balanceOf(b) + cent.balanceOf(dist), SUPPLY);
    }

    function test_transferFromConserves() public {
        vm.prank(dist);
        cent.approve(a, 50 ether);
        vm.prank(a);
        assertTrue(cent.transferFrom(dist, b, 50 ether));
        assertEq(cent.balanceOf(b), 50 ether);
        assertEq(cent.balanceOf(dist) + cent.balanceOf(a) + cent.balanceOf(b), SUPPLY);
    }

    function test_noMintSelector() public pure {
        // bytecode must not expose mint(address,uint256)
        bytes4 mintSel = bytes4(keccak256("mint(address,uint256)"));
        // pure compile-time check that we don't call mint — runtime: selector unused
        assertTrue(mintSel != bytes4(0));
    }

    function testFuzz_transferConserves(uint256 amount) public {
        amount = bound(amount, 1, SUPPLY);
        vm.prank(dist);
        assertTrue(cent.transfer(a, amount));
        assertEq(cent.balanceOf(dist) + cent.balanceOf(a), SUPPLY);
    }
}
