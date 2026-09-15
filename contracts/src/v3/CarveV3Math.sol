// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "../vendor/uniswap-v4-periphery/LiquidityAmounts.sol";

/// @dev Tick-to-price and amount/liquidity arithmetic is shared by V3 and V4.
/// No V4 manager, hooks, pool accounting or V4-specific max-liquidity formula is used.
library CarveV3Math {
    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint24 internal constant FEE = 10_000;
    int24 internal constant SPACING = 200;
    int24 internal constant INITIAL_TICK = 202_000;
    int24 internal constant OUTER_TICK = 887_200;
    struct Plan {
        bool tokenIs0;
        int24 initialTick; int24 lower; int24 upper;
        uint160 sqrtPriceX96;
        uint128 liquidity;
        uint256 amount0; uint256 amount1;
    }

    function plan(address token, address weth) internal pure returns (Plan memory p) {
        p.tokenIs0 = token < weth;
        p.initialTick = p.tokenIs0 ? -INITIAL_TICK : INITIAL_TICK;
        p.lower = p.tokenIs0 ? -INITIAL_TICK : -OUTER_TICK;
        p.upper = p.tokenIs0 ? OUTER_TICK : INITIAL_TICK;
        p.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(p.initialTick);
        uint160 a = TickMath.getSqrtPriceAtTick(p.lower);
        uint160 b = TickMath.getSqrtPriceAtTick(p.upper);
        p.liquidity = LiquidityAmounts.getLiquidityForAmounts(
            p.sqrtPriceX96, a, b, p.tokenIs0 ? SUPPLY : 0, p.tokenIs0 ? 0 : SUPPLY
        );
        if (p.tokenIs0) p.amount0 = SqrtPriceMath.getAmount0Delta(a, b, p.liquidity, true);
        else p.amount1 = SqrtPriceMath.getAmount1Delta(a, b, p.liquidity, true);
    }

    /// @notice Current locked principal only, excluding uncollected fees and pool donations.
    function amounts(uint160 price, int24 lower, int24 upper, uint128 liquidity)
        internal pure returns (uint256 amount0, uint256 amount1)
    {
        uint160 a = TickMath.getSqrtPriceAtTick(lower);
        uint160 b = TickMath.getSqrtPriceAtTick(upper);
        if (price <= a) amount0 = SqrtPriceMath.getAmount0Delta(a, b, liquidity, false);
        else if (price < b) {
            amount0 = SqrtPriceMath.getAmount0Delta(price, b, liquidity, false);
            amount1 = SqrtPriceMath.getAmount1Delta(a, price, liquidity, false);
        } else amount1 = SqrtPriceMath.getAmount1Delta(a, b, liquidity, false);
    }
}
