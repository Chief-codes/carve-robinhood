// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Design boundary ONLY. Nothing in the prototype can call an adapter or migrate funds.
/// @dev This interface is not evidence of Uniswap v4 integration or migration readiness.
/// A future independently reviewed version must bind pool, tokens, recipient and minimum liquidity,
/// handle v4 unlock/callback accounting, and prove receipts before irreversible state changes.
interface ICarveMigrationAdapter {
    struct MigrationRequest {
        address token;
        address immutableLPRecipient;
        uint256 tokenAmount;
        uint256 minLiquidity;
        uint256 deadline;
        bytes32 expectedPoolId;
    }
    function migrate(MigrationRequest calldata request) external payable returns (bytes32 poolId, uint256 liquidity);
}
