// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice Immutable engine boundary for a permanently owned native-ETH v4 core position.
/// @dev The engine is both adapter and locker. No transferable position NFT or caller-selected payload.
interface ICarveMigrationAdapterV2 {
    struct MigrationReceipt {
        bytes32 poolId;
        uint128 liquidity;
        uint256 ethSpent;
        uint256 tokensSpent;
        uint256 lockedETH;
        uint256 lockedTokens;
    }

    function factory() external view returns (address);
    function poolManager() external view returns (address);
    function getReceipt(address market) external view returns (MigrationReceipt memory);

    /// @notice Verify the canonical core position: engine owner, immutable ticks, market-specific salt,
    ///         complete committed pool identity and recorded original liquidity.
    function verifyPosition(address market) external view returns (bool);

    /// @dev Authenticate msg.sender with the immutable factory's isMarket registry and read its snapshot
    ///      independently. Accept exact reserve principal and pull the accounted inventory maximum only.
    ///      Enforce independently computed liquidity as well as the caller's stricter minimum. Lock
    ///      all unspent accounted principal, retain the position permanently, and store the verified receipt.
    function migrate(address token, uint256 inventory, uint128 minLiquidity, uint256 deadline)
        external payable returns (MigrationReceipt memory receipt);
}
