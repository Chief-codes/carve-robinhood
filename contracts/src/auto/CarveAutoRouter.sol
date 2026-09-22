// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CarveAutoEngine} from "./CarveAutoEngine.sol";
import {CarveToken} from "../CarveToken.sol";
import {CarveEscrow} from "../CarveEscrow.sol";

/// @notice Explicitly approved Carve-token swaps; never calls arbitrary routers or spends donations.
/// @dev Kept separate from the fee hook so core does not omit hook callbacks for self-swaps.
///      Native sale proceeds and refunds are paid directly, with credit fallback for rejecting receivers.
contract CarveAutoRouter is CarveEscrow {
    using PoolIdLibrary for PoolKey;
    CarveAutoEngine public immutable engine;
    IPoolManager public immutable poolManager;
    bytes32 private activeSwap;
    struct Order {
        address account;
        address token;
        bool buy;
        bool exactInput;
        uint256 amount;
        uint256 limit;
        uint160 sqrtPriceLimitX96;
    }
    error InvalidOrder();
    error InvalidCallback();
    error TradeSlippage();
    event Swapped(address indexed account, address indexed token, bool buy, uint256 input, uint256 output);

    constructor(CarveAutoEngine engine_) {
        if (address(engine_).code.length == 0) revert InvalidOrder();
        engine = engine_;
        poolManager = IPoolManager(engine_.poolManager());
    }
    receive() external payable { if (msg.sender != address(poolManager)) revert InvalidCallback(); }

    function swapExactInput(address token, bool buy, uint256 amountIn, uint256 minOut,
        uint160 priceLimit, uint256 deadline) external payable nonReentrant returns (uint256 input, uint256 output)
    {
        if (deadline < block.timestamp || amountIn == 0 || amountIn > uint256(uint128(type(int128).max))
            || msg.value != (buy ? amountIn : 0)) revert InvalidOrder();
        return _swap(Order(msg.sender, token, buy, true, amountIn, minOut, priceLimit));
    }

    function swapExactOutput(address token, bool buy, uint256 amountOut, uint256 maxIn,
        uint160 priceLimit, uint256 deadline) external payable nonReentrant returns (uint256 input, uint256 output)
    {
        if (deadline < block.timestamp || amountOut == 0 || maxIn == 0
            || amountOut > uint256(uint128(type(int128).max)) || maxIn > uint256(uint128(type(int128).max))
            || msg.value != (buy ? maxIn : 0)) revert InvalidOrder();
        return _swap(Order(msg.sender, token, buy, false, amountOut, maxIn, priceLimit));
    }

    function _swap(Order memory order) private returns (uint256 input, uint256 output) {
        PoolKey memory key = engine.keyForToken(order.token);
        if (engine.marketForPool(PoolId.unwrap(key.toId())) == address(0)) revert InvalidOrder();
        if (order.sqrtPriceLimitX96 == 0) order.sqrtPriceLimitX96 = order.buy
            ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        bytes memory request = abi.encode(order);
        activeSwap = keccak256(request);
        (input, output) = abi.decode(poolManager.unlock(request), (uint256, uint256));
        if (activeSwap != bytes32(0)) revert InvalidCallback();
        uint256 maxInput = order.exactInput ? order.amount : order.limit;
        if (order.buy && maxInput > input) _payOrCredit(order.account, maxInput - input);
        if (!order.buy) _payOrCredit(order.account, output);
        emit Swapped(order.account, order.token, order.buy, input, output);
    }

    function _payOrCredit(address recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(recipient).call{value: amount, gas: 30_000}("");
        if (!ok) _credit(recipient, amount);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || activeSwap == bytes32(0) || keccak256(data) != activeSwap)
            revert InvalidCallback();
        activeSwap = bytes32(0);
        Order memory order = abi.decode(data, (Order));
        BalanceDelta delta = poolManager.swap(engine.keyForToken(order.token),
            SwapParams(order.buy, order.exactInput ? -int256(order.amount) : int256(order.amount),
                order.sqrtPriceLimitX96), "");
        int128 inputDelta = order.buy ? delta.amount0() : delta.amount1();
        int128 outputDelta = order.buy ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0) revert TradeSlippage();
        uint256 input = uint256(-int256(inputDelta));
        uint256 output = uint256(int256(outputDelta));
        if (input > (order.exactInput ? order.amount : order.limit)
            || output < (order.exactInput ? order.limit : order.amount)) revert TradeSlippage();
        if (order.buy) {
            poolManager.sync(Currency.wrap(address(0)));
            if (poolManager.settle{value: input}() != input) revert InvalidCallback();
            poolManager.take(Currency.wrap(order.token), order.account, output);
        } else {
            poolManager.sync(Currency.wrap(order.token));
            if (!CarveToken(order.token).transferFrom(order.account, address(poolManager), input)) revert InvalidOrder();
            if (poolManager.settle() != input) revert InvalidCallback();
            poolManager.take(Currency.wrap(address(0)), address(this), output);
        }
        return abi.encode(input, output);
    }
}
