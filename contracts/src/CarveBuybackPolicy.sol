// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Candidate policy for opt-in creator-fee buybacks; not deployed.
/// @dev Input is ONLY the creator fee, after the separate Carve platform fee.
library CarveBuybackPolicy {
    uint256 internal constant CREATOR_SHARE_BPS = 2_000;
    uint256 internal constant BPS = 10_000;

    function split(uint256 creatorFee) internal pure returns (uint256 revenue, uint256 buyback) {
        // Division first plus remainder avoids multiplication overflow.
        revenue = (creatorFee / BPS) * CREATOR_SHARE_BPS
            + (creatorFee % BPS) * CREATOR_SHARE_BPS / BPS;
        buyback = creatorFee - revenue;
    }
}
