// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/* -------------------------------------------------------------------------- */
/*  SETTLEMENT BATCHER — ENG-A / CAPITAL                                      */
/*  Anchors Merkle roots of settlement receipts every slot. Anchoring exists  */
/*  to amortize L1 fees, not to custody anything — the failure mode we defend */
/*  is WITHHOLDING, not theft (DOC-07 §03):                                   */
/*                                                                            */
/*   · batchers hold 2-of-3 multisig authority, rotated per epoch             */
/*   · after 2 missed windows, ANYONE may anchor with a single signer signature */
/*   · roots are append-only; MEV front-running gains nothing                  */
/*   · no pause; no upgrade path                                               */
/* -------------------------------------------------------------------------- */

contract SettlementBatcher {
    struct Batch {
        bytes32 root;
        uint32 count;
        uint64 anchoredAt;
        address submitter;
        bool emergency;
    }

    /* --------------------------- constants -------------------------------- */

    uint8 public constant SIGS_REQUIRED = 2; // regular anchor threshold (2-of-3)
    uint8 public constant SIGNER_COUNT = 3;
    uint256 public constant EMERGENCY_MISSES = 2; // permissionless after 2 misses

    bytes32 public constant BATCH_TYPEHASH =
        keccak256("Batch(uint64 batchId,bytes32 root,uint32 count,bool emergency)");
    bytes32 public constant ROTATE_TYPEHASH =
        keccak256("Rotate(uint8 slot,address next,uint64 rotateNonce)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EthereumEIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /* ------------------------- immutables/state ---------------------------- */

    bytes32 private immutable DOMAIN_SEPARATOR;

    address[SIGNER_COUNT] public signers;
    mapping(address => bool) public isSigner;
    uint64 public rotateNonce;

    uint256 public batchWindow; // target blocks per slot (e.g. 15 for ~30s on Base)

    uint64 public nextBatchId;
    uint64 public lastAnchoredAt;
    uint64 public missedWindows;
    mapping(uint64 => Batch) public batches;

    /* ------------------------------ events --------------------------------- */

    event BatchAnchored(uint64 indexed batchId, bytes32 indexed root, uint32 count, address submitter, bool emergency);
    event SignerRotated(uint8 indexed slot, address prev, address next, uint64 rotateNonce);

    /* ------------------------------ errors --------------------------------- */

    error Reentrant();
    error ZeroAddress();
    error DuplicateSigner();
    error NotASigner();
    error InsufficientSignatures();
    error BadSignature();
    error TooEarly();
    error EmptyRoot();
    error BadSlot();

    uint256 private _reentrancyLock;
    modifier nonReentrant() {
        if (_reentrancyLock != 0) revert Reentrant();
        _reentrancyLock = 1;
        _;
        _reentrancyLock = 0;
    }

    /* ---------------------------- constructor ------------------------------- */

    constructor(address[3] memory initialSigners, uint256 windowBlocks) {
        for (uint8 i = 0; i < SIGNER_COUNT; i++) {
            if (initialSigners[i] == address(0)) revert ZeroAddress();
            if (isSigner[initialSigners[i]]) revert DuplicateSigner();
            isSigner[initialSigners[i]] = true;
            signers[i] = initialSigners[i];
        }
        batchWindow = windowBlocks;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("SettlementBatcher"),
                keccak256("0.1"),
                block.chainid,
                address(this)
            )
        );
        lastAnchoredAt = uint64(block.number);
    }

    /* ------------------------------ anchoring ------------------------------- */

    /// @notice Regular anchor: 2-of-3 distinct current signers over EIP-712 batch digest.
    function anchorRoot(bytes32 root, uint32 count, bytes[] calldata sigs) external nonReentrant {
        if (root == bytes32(0)) revert EmptyRoot();
        bytes32 digest = _batchDigest(nextBatchId, root, count, false);
        if (!_haveQuorum(digest, sigs, SIGS_REQUIRED)) revert InsufficientSignatures();
        _anchor(root, count, false);
    }

    /// @notice Permissionless emergency: after EMERGENCY_MISSES consecutive missed
    ///         windows, a single current-signature anchors. (DOC-07 withholding defense)
    function emergencyAnchor(bytes32 root, uint32 count, bytes calldata sig) external nonReentrant {
        if (root == bytes32(0)) revert EmptyRoot();
        if (missedWindows < EMERGENCY_MISSES) revert TooEarly();

        bytes32 digest = _batchDigest(nextBatchId, root, count, true);
        address rec = _recover(digest, sig);
        if (rec == address(0)) revert BadSignature();
        if (!isSigner[rec]) revert NotASigner();

        _anchor(root, count, true);
    }

    /// @notice Marks a missed window. Anyone may call — the ledger itself needs it.
    function markMissedWindow() external {
        if (block.number < lastAnchoredAt + batchWindow * (missedWindows + 1)) revert TooEarly();
        missedWindows += 1;
    }

    function _anchor(bytes32 root, uint32 count, bool emergency) internal {
        uint64 id = nextBatchId;
        batches[id] = Batch({
            root: root,
            count: count,
            anchoredAt: uint64(block.number),
            submitter: msg.sender,
            emergency: emergency
        });
        nextBatchId = id + 1;
        lastAnchoredAt = uint64(block.number);
        missedWindows = 0;
        emit BatchAnchored(id, root, count, msg.sender, emergency);
    }

    /* ------------------------------ rotation -------------------------------- */

    /// @notice Epoch key rotation: 2-of-3 current signers may rotate ONE slot.
    ///         The outgoing signer loses authority immediately; open roots
    ///         signed by it after rotation are invalid (signature recovery is
    ///         checked against the CURRENT set at submission time).
    function rotateSigner(uint8 slot, address next, bytes[] calldata sigs) external nonReentrant {
        if (slot >= SIGNER_COUNT) revert BadSlot();
        if (next == address(0)) revert ZeroAddress();
        if (isSigner[next]) revert DuplicateSigner();

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(ROTATE_TYPEHASH, slot, next, rotateNonce)))
        );
        if (!_haveQuorum(digest, sigs, SIGS_REQUIRED)) revert InsufficientSignatures();

        address prev = signers[slot];
        isSigner[prev] = false;
        signers[slot] = next;
        isSigner[next] = true;
        rotateNonce += 1;
        emit SignerRotated(slot, prev, next, rotateNonce - 1);
    }

    /* --------------------------- signature utils ---------------------------- */

    function _batchDigest(uint64 id, bytes32 root, uint32 count, bool emergency) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(BATCH_TYPEHASH, id, root, count, emergency))
            )
        );
    }

    /// @dev returns true when ≥ required DISTINCT valid signatures from the
    ///      CURRENT signer set are present (order-independent).
    function _haveQuorum(bytes32 digest, bytes[] calldata sigs, uint8 required) internal view returns (bool) {
        uint8 ok = 0;
        address[SIGNER_COUNT] memory seen;
        for (uint256 i = 0; i < sigs.length && ok < required; i++) {
            address rec = _recover(digest, sigs[i]);
            if (rec == address(0) || !isSigner[rec]) continue;
            bool dup;
            for (uint256 j = 0; j < SIGNER_COUNT; j++) {
                if (seen[j] == rec) {
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                seen[ok] = rec;
                ok += 1;
            }
        }
        return ok >= required;
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }

    function domainSeparator() external view returns (bytes32) {
        return DOMAIN_SEPARATOR;
    }
}
