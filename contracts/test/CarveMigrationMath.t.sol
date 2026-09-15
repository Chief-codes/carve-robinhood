// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveMigrationMath} from "../src/CarveMigrationMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface MigrationMathVm { function expectRevert(bytes4 selector) external; }

contract MigrationMathHarness {
    function plan(uint256 inventory) external pure returns (CarveMigrationMath.Plan memory) {
        return CarveMigrationMath.plan(inventory);
    }
    function snapshot(uint256 supply, uint256 virtualETH, uint256 reserveETH, uint256 inventory)
        external pure returns (CarveMigrationMath.Plan memory)
    { return CarveMigrationMath.plan(supply, virtualETH, reserveETH, inventory); }
}

contract CarveMigrationMathTest {
    MigrationMathVm private constant vm = MigrationMathVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant S = 1e27;
    uint256 private constant D = 5.88 ether;
    uint256 private constant R = 4.2 ether;
    uint256 private constant MIN_I = (S * 1.68 ether - 1) / D + 1;
    MigrationMathHarness private harness;

    function setUp() public { harness = new MigrationMathHarness(); }

    function testRejectsInventoryOutsideSupportedInterval() public {
        vm.expectRevert(CarveMigrationMath.UnsupportedInventory.selector); harness.plan(0);
        vm.expectRevert(CarveMigrationMath.UnsupportedInventory.selector); harness.plan(1);
        vm.expectRevert(CarveMigrationMath.UnsupportedInventory.selector); harness.plan(MIN_I - 1);
        vm.expectRevert(CarveMigrationMath.UnsupportedInventory.selector); harness.plan(S + 1);
        vm.expectRevert(CarveMigrationMath.UnsupportedInventory.selector); harness.plan(type(uint256).max);
    }

    function testSnapshotRejectsEveryChangedEconomicTerm() public {
        vm.expectRevert(CarveMigrationMath.UnsupportedEconomics.selector); harness.snapshot(S - 1, 1.68 ether, R, MIN_I);
        vm.expectRevert(CarveMigrationMath.UnsupportedEconomics.selector); harness.snapshot(S + 1, 1.68 ether, R, MIN_I);
        vm.expectRevert(CarveMigrationMath.UnsupportedEconomics.selector); harness.snapshot(S, 1.68 ether - 1, R, MIN_I);
        vm.expectRevert(CarveMigrationMath.UnsupportedEconomics.selector); harness.snapshot(S, 1.68 ether + 1, R, MIN_I);
        vm.expectRevert(CarveMigrationMath.UnsupportedEconomics.selector); harness.snapshot(S, 1.68 ether, R - 1, MIN_I);
        vm.expectRevert(CarveMigrationMath.UnsupportedEconomics.selector); harness.snapshot(S, 1.68 ether, R + 1, MIN_I);
        vm.expectRevert(CarveMigrationMath.UnsupportedEconomics.selector);
        harness.snapshot(type(uint256).max, type(uint256).max, type(uint256).max, MIN_I);
        require(keccak256(abi.encode(harness.snapshot(S, 1.68 ether, R, MIN_I)))
            == keccak256(abi.encode(harness.plan(MIN_I))), "snapshot overload");
    }

    function testIntervalEndpointsAndAdjacentValues() public pure {
        for (uint256 i; i < 128; ++i) {
            _assertPlan(MIN_I + i);
            _assertPlan(S - i);
        }
    }

    function testRoundingResiduesAcrossInterval() public pure {
        // R/D = 5/7. Exercise every token-allocation remainder near 65 distinct
        // magnitudes rather than testing only round decimal inventory snapshots.
        for (uint256 i; i <= 64; ++i) {
            uint256 center = MIN_I + (S - MIN_I) * i / 64;
            for (uint256 j; j < 7 && center + j <= S; ++j) _assertPlan(center + j);
        }
    }

    function testFuzzSupportedInventory(uint256 seed) public pure {
        _assertPlan(MIN_I + seed % (S - MIN_I + 1));
    }

    function testIndependentBigIntReferenceFor256Snapshots() public pure {
        // Regenerate with: node scripts/migration-math-reference.mjs
        // Its restoring-binary root and unbounded exact rational liquidity/cost
        // formulas do not call or reproduce the Solidity mulDiv implementation.
        bytes32 digest;
        for (uint256 i; i < 256; ++i) {
            uint256 inventory = MIN_I + (S - MIN_I) * i / 255;
            digest = keccak256(abi.encode(digest, inventory, CarveMigrationMath.plan(inventory)));
        }
        require(digest == 0x30774f2049891673c2d7cca7532f5acb55c76a691744dfdd242daf77cad1ad06, "BigInt reference corpus");
    }

    function testFuzzOutsideInterval(uint256 value) public {
        if (value >= MIN_I && value <= S) return;
        vm.expectRevert(CarveMigrationMath.UnsupportedInventory.selector);
        harness.plan(value);
    }

    function testFuzzPriceMonotonicity(uint256 a, uint256 b) public pure {
        a = MIN_I + a % (S - MIN_I + 1);
        b = MIN_I + b % (S - MIN_I + 1);
        if (a > b) (a, b) = (b, a);
        require(CarveMigrationMath.plan(a).sqrtPriceX96 <= CarveMigrationMath.plan(b).sqrtPriceX96, "price orientation");
    }

    function testSquareRootSmallDomainExhaustively() public pure {
        uint256 expected;
        for (uint256 x; x < 16_384; ++x) {
            if ((expected + 1) * (expected + 1) <= x) ++expected;
            require(CarveMigrationMath.sqrt(x) == expected, "small-domain root");
        }
    }

    function testSquareRootAllPowerOfTwoBoundaries() public pure {
        _assertRoot(0);
        _assertRoot(type(uint256).max);
        for (uint256 bit; bit < 256; ++bit) {
            uint256 x = uint256(1) << bit;
            _assertRoot(x - 1);
            _assertRoot(x);
            _assertRoot(x + 1);
        }
        for (uint256 bit; bit < 128; ++bit) {
            uint256 root = (uint256(1) << bit) + 123;
            uint256 square = root * root;
            _assertRoot(square - 1); _assertRoot(square); _assertRoot(square + 1);
        }
    }

    function testFuzzSquareRoot(uint256 x) public pure { _assertRoot(x); }

    function testFloorRoundedTradesPreserveTerminalLowerBound() public pure {
        uint256 inventory = S;
        uint256 reserve;
        uint256 k = inventory * (1.68 ether + reserve);
        // Model fee-exclusive fills directly; fees never belong to curve reserves.
        for (uint256 i; i < 128; ++i) {
            uint256 net = (R - reserve) / 3;
            uint256 bought = inventory * net / (1.68 ether + reserve + net);
            inventory -= bought; reserve += net;
            require(inventory * (1.68 ether + reserve) >= k, "buy invariant");
            k = inventory * (1.68 ether + reserve);
            uint256 sold = bought / 2;
            uint256 gross = (1.68 ether + reserve) * sold / (inventory + sold);
            inventory += sold; reserve -= gross;
            require(inventory * (1.68 ether + reserve) >= k, "sell invariant");
            k = inventory * (1.68 ether + reserve);
        }
        uint256 finalNet = R - reserve;
        inventory -= inventory * finalNet / (1.68 ether + reserve + finalNet);
        require(inventory >= MIN_I && inventory <= S, "terminal interval");
        _assertPlan(inventory);
    }

    function _assertRoot(uint256 x) private pure {
        uint256 z = CarveMigrationMath.sqrt(x);
        if (x == 0) { require(z == 0, "zero root"); return; }
        require(z != 0 && z <= x / z, "root floor lower");
        require(z + 1 > x / (z + 1), "root floor upper");
    }

    function _assertPlan(uint256 inventory) private pure {
        CarveMigrationMath.Plan memory p = CarveMigrationMath.plan(inventory);
        require(p.tickLower == -887200 && p.tickUpper == 887200, "usable full range");
        require(p.amount0Max == R && p.amount1Max == inventory * 5 / 7, "nominal maxima");
        require(p.amount0 > 0 && p.amount0 <= p.amount0Max, "ETH mint bounds");
        require(p.amount1 > 0 && p.amount1 <= p.amount1Max, "token mint bounds");
        require(p.amount0 + p.lockedETH == R && p.amount1 + p.lockedTokens == inventory, "principal conservation");
        require(p.lockedTokens >= inventory - p.amount1Max, "nominal surplus retained");
        require(p.liquidity > 0 && p.liquidity <= type(uint128).max / 8874, "per-tick bound");
        require(p.liquidity <= uint128(type(int128).max), "signed liquidity");

        // Independent quotient/remainder decomposition: its remainder * Q192
        // fits because D < 2^63. No FullMath invocation or floating point here.
        uint256 q192 = uint256(1) << 192;
        uint256 rationalFloor = (inventory / D) * q192 + ((inventory % D) * q192) / D;
        uint256 square = uint256(p.sqrtPriceX96) * p.sqrtPriceX96;
        uint256 nextSquare = (uint256(p.sqrtPriceX96) + 1) * (uint256(p.sqrtPriceX96) + 1);
        require(square <= rationalFloor && nextSquare > rationalFloor, "exact rational root");

        uint160 low = TickMath.getSqrtPriceAtTick(p.tickLower);
        uint160 high = TickMath.getSqrtPriceAtTick(p.tickUpper);
        require(p.sqrtPriceX96 > low && p.sqrtPriceX96 < high, "price inside ticks");
        require(SqrtPriceMath.getAmount0Delta(p.sqrtPriceX96, high, p.liquidity, true) == p.amount0, "core ETH delta");
        require(SqrtPriceMath.getAmount1Delta(low, p.sqrtPriceX96, p.liquidity, true) == p.amount1, "core token delta");
        require(SqrtPriceMath.getAmount0Delta(p.sqrtPriceX96, high, p.liquidity, false) <= p.amount0, "ETH ceil");
        require(SqrtPriceMath.getAmount1Delta(low, p.sqrtPriceX96, p.liquidity, false) <= p.amount1, "token ceil");
        // In this bounded range, upstream's conservative double-floor amount0
        // calculation also reaches the exact largest liquidity fitting maxima.
        require(SqrtPriceMath.getAmount0Delta(p.sqrtPriceX96, high, p.liquidity + 1, true) > p.amount0Max
            || SqrtPriceMath.getAmount1Delta(low, p.sqrtPriceX96, p.liquidity + 1, true) > p.amount1Max, "maximal fitting liquidity");
    }
}
