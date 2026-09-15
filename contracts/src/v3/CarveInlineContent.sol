// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "../CarveContentRegistry.sol";

/// @notice Small files can be committed in the same transaction as a token launch.
/// @dev Registry manifests record the calling factory as registrant. Token.creator
///      still records the authenticated user. This limit is a product safety bound,
///      not a claim about Robinhood's maximum transaction size. Large content uses
///      the existing resumable upload flow and supplies already-registered roots.
library CarveInlineContent {
    uint256 internal constant MAX_INLINE_BYTES = 24_576;
    uint256 private constant CHUNK_BYTES = 20_480;

    struct Asset {
        bytes32 root;
        string mimeType;
        string encoding;
        bytes data;
    }

    error InvalidInlineAsset();
    error InlineContentTooLarge();
    error InvalidContentRoot();

    /// @param assets Image, audio and website, in that order. Empty slots are allowed.
    function prepare(CarveContentRegistry registry, Asset[3] calldata assets)
        internal returns (bytes32[3] memory roots)
    {
        uint256 size;
        // Validate the complete request before any external content writes.
        for (uint256 i; i < 3; ++i) {
            Asset calldata asset = assets[i];
            size += asset.data.length;
            if (size > MAX_INLINE_BYTES) revert InlineContentTooLarge();
            if (asset.root != bytes32(0)) {
                if (asset.data.length != 0 || bytes(asset.mimeType).length != 0 || bytes(asset.encoding).length != 0)
                    revert InvalidInlineAsset();
                if (!registry.exists(asset.root)) revert InvalidContentRoot();
            } else if (asset.data.length == 0) {
                if (bytes(asset.mimeType).length != 0 || bytes(asset.encoding).length != 0)
                    revert InvalidInlineAsset();
            } else {
                bytes32 encoding = keccak256(bytes(asset.encoding));
                if (bytes(asset.mimeType).length == 0 || bytes(asset.mimeType).length > 96
                    || (encoding != keccak256("identity") && encoding != keccak256("gzip")))
                    revert InvalidInlineAsset();
            }
        }
        for (uint256 i; i < 3; ++i) {
            Asset calldata asset = assets[i];
            if (asset.root != bytes32(0)) roots[i] = asset.root;
            else if (asset.data.length != 0) roots[i] = _write(registry, asset);
        }
    }

    function _write(CarveContentRegistry registry, Asset calldata asset) private returns (bytes32 root) {
        uint256 count = (asset.data.length + CHUNK_BYTES - 1) / CHUNK_BYTES;
        address[] memory pointers = new address[](count);
        bytes32[] memory hashes = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            uint256 start = i * CHUNK_BYTES;
            uint256 end = start + CHUNK_BYTES;
            if (end > asset.data.length) end = asset.data.length;
            (pointers[i], hashes[i]) = registry.writeChunk(asset.data[start:end]);
        }
        root = keccak256(abi.encode(uint8(1), asset.mimeType, asset.encoding, asset.data.length, pointers, hashes));
        if (!registry.exists(root)) {
            bytes32 registered = registry.registerContent(
                asset.mimeType, asset.encoding, asset.data.length, pointers, hashes
            );
            if (registered != root) revert InvalidContentRoot();
        }
    }
}
