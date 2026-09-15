// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {BitMath} from "@uniswap/v4-core/src/libraries/BitMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "./vendor/uniswap-v4-periphery/LiquidityAmounts.sol";

/// @notice Pure full-range migration plan for Carve's approved native-ETH curve.
/// @dev Currency0 is native ETH and currency1 is the 18-decimal launch token.
///      This library authenticates no market and moves no assets. The adapter must
///      bind the snapshot to its registered market and reconcile actual settlement.
library CarveMigrationMath {
    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint256 internal constant VIRTUAL_ETH = 1.68 ether;
    uint256 internal constant RESERVE_CAP = 4.2 ether;
    uint256 internal constant TERMINAL_QUOTE = VIRTUAL_ETH + RESERVE_CAP;
    int24 internal constant TICK_SPACING = 200;
    uint24 internal constant POOL_FEE = 0;
    // Every successful floor-rounded curve trade preserves or increases
    // (V + R) * inventory, starting at V * SUPPLY. No token is minted later.
    uint256 internal constant MIN_TERMINAL_INVENTORY = (SUPPLY * VIRTUAL_ETH - 1) / TERMINAL_QUOTE + 1;
    uint256 internal constant MAX_TERMINAL_INVENTORY = SUPPLY;
    // Pinned v4 Pool.tickSpacingToMaxLiquidityPerTick floors MIN_TICK/spacing:
    // floor(-887272/200) = -4437, floor(887272/200) = 4436, count = 8874.
    uint128 internal constant MAX_LIQUIDITY_PER_TICK = type(uint128).max / 8874;
    uint256 private constant MAX_SIGNED_AMOUNT = uint256(uint128(type(int128).max));

    struct Plan {
        uint160 sqrtPriceX96;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 amount0Max;
        uint128 amount1Max;
        uint128 amount0;
        uint128 amount1;
        uint256 lockedETH;
        uint256 lockedTokens;
    }

    error UnsupportedEconomics();
    error UnsupportedInventory();
    error UnseedablePlan();

    /// @notice Validate a complete authenticated terminal snapshot before planning.
    function plan(uint256 supply, uint256 virtualETH, uint256 reserveETH, uint256 inventory)
        internal pure returns (Plan memory)
    {
        if (supply != SUPPLY || virtualETH != VIRTUAL_ETH || reserveETH != RESERVE_CAP) {
            revert UnsupportedEconomics();
        }
        return plan(inventory);
    }

    /// @notice Plan an inventory snapshot after the caller validates fixed economics.
    /// @dev Preserves fee-exclusive marginal price, rounded down in sqrt-price units.
    ///      Nominal token maximum = floor(R*I/(V+R)); both actual mint amounts round
    ///      up, as v4 requires. All inventory minus amount1 and R minus amount0 are
    ///      locked principal, including finite-tick and integer-rounding residuals.
    function plan(uint256 inventory) internal pure returns (Plan memory p) {
        if (inventory < MIN_TERMINAL_INVENTORY || inventory > MAX_TERMINAL_INVENTORY) {
            revert UnsupportedInventory();
        }

        // I/(V+R) <= 1e27/5.88e18 < 2^28, so the Q192 result fits uint256.
        // FullMath handles the 512-bit intermediate; never shift I by 192.
        uint256 ratioX192 = FullMath.mulDiv(inventory, uint256(1) << 192, TERMINAL_QUOTE);
        p.sqrtPriceX96 = uint160(sqrt(ratioX192));
        p.tickLower = TickMath.minUsableTick(TICK_SPACING);
        p.tickUpper = TickMath.maxUsableTick(TICK_SPACING);
        uint160 lower = TickMath.getSqrtPriceAtTick(p.tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(p.tickUpper);
        if (p.sqrtPriceX96 <= lower || p.sqrtPriceX96 >= upper
            || p.sqrtPriceX96 < TickMath.MIN_SQRT_PRICE || p.sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) {
            revert UnseedablePlan();
        }

        p.amount0Max = uint128(RESERVE_CAP);
        p.amount1Max = uint128(FullMath.mulDiv(RESERVE_CAP, inventory, TERMINAL_QUOTE));
        p.liquidity = LiquidityAmounts.getLiquidityForAmounts(
            p.sqrtPriceX96, lower, upper, p.amount0Max, p.amount1Max
        );
        if (p.liquidity == 0 || p.liquidity > MAX_SIGNED_AMOUNT || p.liquidity > MAX_LIQUIDITY_PER_TICK) {
            revert UnseedablePlan();
        }
        uint256 amount0 = SqrtPriceMath.getAmount0Delta(p.sqrtPriceX96, upper, p.liquidity, true);
        uint256 amount1 = SqrtPriceMath.getAmount1Delta(lower, p.sqrtPriceX96, p.liquidity, true);
        if (amount0 == 0 || amount1 == 0 || amount0 > p.amount0Max || amount1 > p.amount1Max
            || amount0 > MAX_SIGNED_AMOUNT || amount1 > MAX_SIGNED_AMOUNT) {
            revert UnseedablePlan();
        }
        p.amount0 = uint128(amount0);
        p.amount1 = uint128(amount1);
        p.lockedETH = RESERVE_CAP - amount0;
        p.lockedTokens = inventory - amount1;
    }

    /// @notice Exact floor square root, including zero and uint256 maximum.
    /// @dev Newton iteration starts at a power of two above the root. The sequence
    ///      decreases to floor(sqrt(x)); the final possible one-unit oscillation
    ///      is stopped before increasing. At most nine iterations for uint256.
    function sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = uint256(1) << ((uint256(BitMath.mostSignificantBit(x)) + 2) / 2);
        while (true) {
            uint256 next = (z + x / z) / 2;
            if (next >= z) return z;
            z = next;
        }
    }
}
