// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface ICarveERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface ICarveWETH is ICarveERC20 {
    function deposit() external payable;
    function withdraw(uint256 value) external;
}

interface ICarveV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
}

interface ICarveV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function maxLiquidityPerTick() external view returns (uint128);
    function initialize(uint160 sqrtPriceX96) external;
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked
    );
}

interface ICarveV3PositionManager {
    struct MintParams {
        address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper;
        uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min;
        address recipient; uint256 deadline;
    }
    struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }
    struct Position {
        uint96 nonce; address operator; address token0; address token1; uint24 fee;
        int24 tickLower; int24 tickUpper; uint128 liquidity;
        uint256 feeGrowthInside0LastX128; uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0; uint128 tokensOwed1;
    }
    function factory() external view returns (address);
    function WETH9() external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function positions(uint256 tokenId) external view returns (Position memory);
    function mint(MintParams calldata params) external payable returns (
        uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1
    );
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}

/// @dev SwapRouter02 differs from the older SwapRouter: this struct has no deadline.
interface ICarveV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function factory() external view returns (address);
    function WETH9() external view returns (address);
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Fixed Robinhood-chain canonical dependencies, not the Pons launch factory or locker.
library CarveV3Addresses {
    address internal constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address internal constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
}
