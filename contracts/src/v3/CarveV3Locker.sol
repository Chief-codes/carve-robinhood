// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveV3Math} from "./CarveV3Math.sol";
import {CarveV3Addresses, ICarveERC20, ICarveV3Factory, ICarveV3Pool, ICarveV3PositionManager}
    from "./CarveV3Interfaces.sol";

/// @notice Irrevocable custody of the launch position and unused launch-token dust.
/// @dev No admin, upgrade, approval, NFT-transfer, decreaseLiquidity, arbitrary-call or rescue path.
/// Fee withdrawals can move only the exact amounts returned by canonical collect calls.
contract CarveV3Locker {
    struct LockedPosition {
        address pool; uint256 tokenId; uint128 initialLiquidity;
        int24 tickLower; int24 tickUpper; uint256 tokenDust;
    }
    address public immutable launchFactory;
    address public immutable platformRecipient;
    mapping(address => LockedPosition) public positions;
    mapping(uint256 => address) public tokenForPosition;
    mapping(address => uint256) public pendingFees;
    mapping(address => uint256) public totalCollected;
    uint256 private guard = 1;
    error Unauthorized();
    error ReentrantCall();
    error InvalidPosition();
    error PoolAlreadyInitialized();
    error TokenTransferFailed();
    error InvalidCollection();
    event PositionLocked(address indexed token, address indexed pool, uint256 indexed tokenId,
        uint128 liquidity, uint256 lockedDust);
    event FeesCollected(address indexed token, uint256 amount0, uint256 amount1);
    event FeesWithdrawn(address indexed asset, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        if (guard != 1) revert ReentrantCall();
        guard = 2; _; guard = 1;
    }

    constructor(address launchFactory_, address platformRecipient_) {
        if (launchFactory_ == address(0) || platformRecipient_ == address(0)) revert Unauthorized();
        launchFactory = launchFactory_;
        platformRecipient = platformRecipient_;
    }

    function createAndLock(address token, uint256 deadline)
        external nonReentrant returns (address pool, uint256 tokenId)
    {
        if (msg.sender != launchFactory) revert Unauthorized();
        if (token == CarveV3Addresses.WETH || token.code.length == 0 || positions[token].pool != address(0)
            || deadline < block.timestamp) revert InvalidPosition();
        CarveV3Math.Plan memory p = CarveV3Math.plan(token, CarveV3Addresses.WETH);
        address token0 = p.tokenIs0 ? token : CarveV3Addresses.WETH;
        address token1 = p.tokenIs0 ? CarveV3Addresses.WETH : token;
        ICarveV3Factory f = ICarveV3Factory(CarveV3Addresses.FACTORY);
        pool = f.getPool(token0, token1, CarveV3Math.FEE);
        if (pool == address(0)) pool = f.createPool(token0, token1, CarveV3Math.FEE);
        ICarveV3Pool v3 = ICarveV3Pool(pool);
        if (v3.factory() != address(f) || v3.token0() != token0 || v3.token1() != token1
            || v3.fee() != CarveV3Math.FEE || v3.tickSpacing() != CarveV3Math.SPACING
            || p.liquidity == 0 || p.liquidity > v3.maxLiquidityPerTick()) revert InvalidPosition();
        (uint160 existing,,,,,,) = v3.slot0();
        // Even a pool initialized to the intended price is rejected: launch must own its initialization.
        if (existing != 0) revert PoolAlreadyInitialized();
        v3.initialize(p.sqrtPriceX96);
        uint256 beforeToken = ICarveERC20(token).balanceOf(address(this));
        uint256 beforeWETH = ICarveERC20(CarveV3Addresses.WETH).balanceOf(address(this));
        if (beforeToken < CarveV3Math.SUPPLY || p.amount0 + p.amount1 > CarveV3Math.SUPPLY)
            revert InvalidPosition();
        ICarveV3PositionManager manager = ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER);
        _approve(token, address(manager), CarveV3Math.SUPPLY);
        uint128 mintedLiquidity;
        uint256 amount0; uint256 amount1;
        (tokenId, mintedLiquidity, amount0, amount1) = manager.mint(ICarveV3PositionManager.MintParams({
            token0: token0, token1: token1, fee: CarveV3Math.FEE,
            tickLower: p.lower, tickUpper: p.upper,
            amount0Desired: p.tokenIs0 ? CarveV3Math.SUPPLY : 0,
            amount1Desired: p.tokenIs0 ? 0 : CarveV3Math.SUPPLY,
            amount0Min: p.amount0, amount1Min: p.amount1, recipient: address(this), deadline: deadline
        }));
        _approve(token, address(manager), 0);
        if (mintedLiquidity != p.liquidity || amount0 != p.amount0 || amount1 != p.amount1
            || beforeToken - ICarveERC20(token).balanceOf(address(this)) != amount0 + amount1
            || ICarveERC20(CarveV3Addresses.WETH).balanceOf(address(this)) != beforeWETH
            || tokenForPosition[tokenId] != address(0)) revert InvalidPosition();
        ICarveV3PositionManager.Position memory pos = manager.positions(tokenId);
        if (manager.ownerOf(tokenId) != address(this) || manager.getApproved(tokenId) != address(0)
            || pos.operator != address(0) || pos.nonce != 0 || pos.tokensOwed0 != 0 || pos.tokensOwed1 != 0
            || pos.token0 != token0 || pos.token1 != token1 || pos.fee != CarveV3Math.FEE
            || pos.tickLower != p.lower || pos.tickUpper != p.upper || pos.liquidity != mintedLiquidity)
            revert InvalidPosition();
        uint256 dust = CarveV3Math.SUPPLY - amount0 - amount1;
        positions[token] = LockedPosition(pool, tokenId, mintedLiquidity, p.lower, p.upper, dust);
        tokenForPosition[tokenId] = token;
        emit PositionLocked(token, pool, tokenId, mintedLiquidity, dust);
    }

    /// @notice Anyone may collect; only the immutable platform recipient receives withdrawal credit.
    function collectFees(address token) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        LockedPosition memory locked = positions[token];
        ICarveV3PositionManager manager = ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER);
        ICarveV3PositionManager.Position memory p = _checkedPosition(token, locked, manager);
        uint256 before0 = ICarveERC20(p.token0).balanceOf(address(this));
        uint256 before1 = ICarveERC20(p.token1).balanceOf(address(this));
        (amount0, amount1) = manager.collect(ICarveV3PositionManager.CollectParams(
            locked.tokenId, address(this), type(uint128).max, type(uint128).max
        ));
        if (ICarveERC20(p.token0).balanceOf(address(this)) - before0 != amount0
            || ICarveERC20(p.token1).balanceOf(address(this)) - before1 != amount1) revert InvalidCollection();
        pendingFees[p.token0] += amount0;
        pendingFees[p.token1] += amount1;
        totalCollected[p.token0] += amount0;
        totalCollected[p.token1] += amount1;
        emit FeesCollected(token, amount0, amount1);
    }

    function withdrawFees(address asset, address recipient) external nonReentrant {
        if (msg.sender != platformRecipient || recipient == address(0)) revert Unauthorized();
        uint256 amount = pendingFees[asset];
        if (amount == 0) revert InvalidCollection();
        pendingFees[asset] = 0;
        if (!ICarveERC20(asset).transfer(recipient, amount)) revert TokenTransferFailed();
        emit FeesWithdrawn(asset, recipient, amount);
    }

    /// @notice Graduation is a reversible current-principal milestone, not a pool migration or trade gate.
    function principal(address token) external view returns (
        uint256 tokenPrincipal, uint256 wethPrincipal, uint256 lockedDust, bool milestoneReached
    ) {
        LockedPosition memory locked = positions[token];
        ICarveV3PositionManager.Position memory p = _checkedPosition(
            token, locked, ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER)
        );
        (uint160 price,,,,,,) = ICarveV3Pool(locked.pool).slot0();
        (uint256 amount0, uint256 amount1) = CarveV3Math.amounts(price, p.tickLower, p.tickUpper, p.liquidity);
        (tokenPrincipal, wethPrincipal) = p.token0 == token ? (amount0, amount1) : (amount1, amount0);
        lockedDust = locked.tokenDust;
        milestoneReached = wethPrincipal >= 4.2 ether;
    }

    function _checkedPosition(address token, LockedPosition memory locked, ICarveV3PositionManager manager)
        private view returns (ICarveV3PositionManager.Position memory p)
    {
        if (locked.pool == address(0)) revert InvalidPosition();
        p = manager.positions(locked.tokenId);
        // NFPM permits third-party liquidity additions to an existing NFT. Such donations stay locked.
        if (manager.ownerOf(locked.tokenId) != address(this) || manager.getApproved(locked.tokenId) != address(0)
            || p.operator != address(0) || p.liquidity < locked.initialLiquidity || p.fee != CarveV3Math.FEE
            || p.tickLower != locked.tickLower || p.tickUpper != locked.tickUpper
            || p.token0 != (token < CarveV3Addresses.WETH ? token : CarveV3Addresses.WETH)
            || p.token1 != (token < CarveV3Addresses.WETH ? CarveV3Addresses.WETH : token)) revert InvalidPosition();
    }

    function _approve(address token, address spender, uint256 amount) private {
        if (!ICarveERC20(token).approve(spender, amount)
            || ICarveERC20(token).allowance(address(this), spender) != amount) revert TokenTransferFailed();
    }
}
