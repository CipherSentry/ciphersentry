// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  B-R4 — rotateSigner happy path + post-rotate stale sig cannot anchor      */
/* -------------------------------------------------------------------------- */

import { Test } from "forge-std/Test.sol";
import { SettlementBatcher } from "../src/SettlementBatcher.sol";

contract BatchRotateTest is Test {
    SettlementBatcher internal batcher;

    uint256 internal constant PK1 = 0xA11CE;
    uint256 internal constant PK2 = 0xB0B;
    uint256 internal constant PK3 = 0xCAFE;
    uint256 internal constant PK_NEXT = 0xD00D;

    address internal s1;
    address internal s2;
    address internal s3;
    address internal next;

    function setUp() public {
        s1 = vm.addr(PK1);
        s2 = vm.addr(PK2);
        s3 = vm.addr(PK3);
        next = vm.addr(PK_NEXT);
        address[3] memory signers = [s1, s2, s3];
        batcher = new SettlementBatcher(signers, 15);
    }

    function _domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EthereumEIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SettlementBatcher"),
                keccak256("0.1"),
                block.chainid,
                address(batcher)
            )
        );
    }

    function _batchDigest(uint64 id, bytes32 root, uint32 count, bool emergency) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domain(),
                keccak256(abi.encode(batcher.BATCH_TYPEHASH(), id, root, count, emergency))
            )
        );
    }

    function _rotateDigest(uint8 slot, address n, uint64 nonce) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domain(),
                keccak256(abi.encode(batcher.ROTATE_TYPEHASH(), slot, n, nonce))
            )
        );
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_rotateSigner_happyPath() public {
        uint64 nonce = batcher.rotateNonce();
        bytes32 dig = _rotateDigest(0, next, nonce);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PK1, dig);
        sigs[1] = _sign(PK2, dig);

        batcher.rotateSigner(0, next, sigs);

        assertTrue(batcher.isSigner(next));
        assertFalse(batcher.isSigner(s1));
        assertEq(batcher.signers(0), next);
        assertEq(batcher.rotateNonce(), nonce + 1);
    }

    function test_postRotate_staleSignerCannotAnchor() public {
        // rotate slot 0: s1 → next
        uint64 nonce = batcher.rotateNonce();
        bytes32 rdig = _rotateDigest(0, next, nonce);
        bytes[] memory rsigs = new bytes[](2);
        rsigs[0] = _sign(PK1, rdig);
        rsigs[1] = _sign(PK2, rdig);
        batcher.rotateSigner(0, next, rsigs);

        // attempt anchor with s1 (stale) + s2 — only one current signer
        bytes32 root = keccak256("root");
        uint64 id = batcher.nextBatchId();
        bytes32 bdig = _batchDigest(id, root, 1, false);
        bytes[] memory asigs = new bytes[](2);
        asigs[0] = _sign(PK1, bdig); // stale — no longer isSigner
        asigs[1] = _sign(PK2, bdig); // current only

        vm.expectRevert(SettlementBatcher.InsufficientSignatures.selector);
        batcher.anchorRoot(root, 1, asigs);
    }

    function test_postRotate_newSetCanAnchor() public {
        uint64 nonce = batcher.rotateNonce();
        bytes32 rdig = _rotateDigest(0, next, nonce);
        bytes[] memory rsigs = new bytes[](2);
        rsigs[0] = _sign(PK2, rdig);
        rsigs[1] = _sign(PK3, rdig);
        batcher.rotateSigner(0, next, rsigs);

        bytes32 root = keccak256("root-ok");
        uint64 id = batcher.nextBatchId();
        bytes32 bdig = _batchDigest(id, root, 2, false);
        bytes[] memory asigs = new bytes[](2);
        asigs[0] = _sign(PK_NEXT, bdig);
        asigs[1] = _sign(PK2, bdig);

        batcher.anchorRoot(root, 2, asigs);
        assertEq(batcher.nextBatchId(), id + 1);
        (bytes32 stored, , , , ) = batcher.batches(id);
        assertEq(stored, root);
    }

    function test_rotate_requiresQuorum() public {
        bytes32 dig = _rotateDigest(1, next, batcher.rotateNonce());
        bytes[] memory one = new bytes[](1);
        one[0] = _sign(PK1, dig);
        vm.expectRevert(SettlementBatcher.InsufficientSignatures.selector);
        batcher.rotateSigner(1, next, one);
    }
}
