// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {CarveToken} from "./CarveToken.sol";
import {CarveMigrationMath} from "./CarveMigrationMath.sol";
import {CarveFeePolicy} from "./CarveFeePolicy.sol";
import {ICarveMigrationAdapterV2} from "./interfaces/ICarveMigrationAdapterV2.sol";

interface ICarveFactoryRegistryV2 {
    function isMarket(address market) external view returns (bool);
    function marketForToken(address token) external view returns (address);
}

interface ICarveMarketSnapshotV2 {
    function token() external view returns (address);
    function creator() external view returns (address);
    function platformRecipient() external view returns (address);
    function creatorFeeBps() external view returns (uint16);
    function reserveETH() external view returns (uint256);
    function inventory() external view returns (uint256);
    function virtualETH() external view returns (uint256);
    function phase() external view returns (uint8);
}

/// @notice Immutable v4 migration, permanent core-position custody and trade-fee hook.
/// @dev No position-removal, owner, sweep, arbitrary call, router, or upgrade entry point.
///      A separate router executes swaps: v4 intentionally skips callbacks on a hook's own swaps.
///      Zero LP fee; the canonical protocol fee controller remains outside Carve's control.
contract CarveV4Engine is ICarveMigrationAdapterV2 {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint160 public constant HOOK_FLAGS = 0x2044;
    uint16 public constant CREATOR_FEE_LIMIT_BPS = 1000;
    address public immutable override factory;
    address public immutable override poolManager;
    mapping(address => MigrationReceipt) private receipts;
    mapping(bytes32 => address) public marketForPool;
    mapping(address => mapping(address => uint256)) public feeCredit;
    mapping(address => uint256) public totalFeeCredit;
    mapping(address => uint256) public lockedPrincipal;
    /// @notice Lifetime absolute native core swap leg per token, before Carve hook fees.
    mapping(address => uint256) public poolVolumeETH;
    address private activeMigration;
    bool private callbackPending;
    struct Withdrawal { address asset; address recipient; uint256 amount; }
    Withdrawal private withdrawal;
    uint256 private guard = 1;

    error InvalidDependency();
    error Unauthorized();
    error InvalidMigration();
    error InvalidDelta();
    error InvalidFee();
    error TransferFailed();
    error ReentrantCall();
    error NoCredit();
    event Migrated(address indexed market, bytes32 indexed poolId, uint128 liquidity,
        uint256 ethSpent, uint256 tokensSpent, uint256 lockedETH, uint256 lockedTokens);
    event TradeFee(address indexed market, address indexed currency, uint256 platformFee, uint256 creatorFee);
    event FeeWithdrawn(address indexed account, address indexed currency, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        if (guard != 1) revert ReentrantCall();
        guard = 2;
        _;
        guard = 1;
    }

    constructor(address poolManager_, address factory_) {
        if (poolManager_.code.length == 0 || factory_ == address(0)
            || (uint160(address(this)) & 0x3fff) != HOOK_FLAGS) revert InvalidDependency();
        poolManager = poolManager_;
        factory = factory_;
    }

    receive() external payable { if (msg.sender != poolManager) revert Unauthorized(); }

    function keyForToken(address token) public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(token), 0, 200, IHooks(address(this)));
    }

    function getReceipt(address market) external view returns (MigrationReceipt memory) { return receipts[market]; }

    function verifyPosition(address market) public view returns (bool) {
        MigrationReceipt memory receipt = receipts[market];
        if (receipt.liquidity == 0 || marketForPool[receipt.poolId] != market) return false;
        (uint128 actual,,) = IPoolManager(poolManager).getPositionInfo(PoolId.wrap(receipt.poolId),
            address(this), -887200, 887200, bytes32(uint256(uint160(market))));
        return actual == receipt.liquidity;
    }

    function migrate(address token, uint256 inventory, uint128 minLiquidity, uint256 deadline)
        external payable nonReentrant returns (MigrationReceipt memory receipt)
    {
        ICarveFactoryRegistryV2 f = ICarveFactoryRegistryV2(factory);
        if (!f.isMarket(msg.sender) || f.marketForToken(token) != msg.sender) revert Unauthorized();
        ICarveMarketSnapshotV2 market = ICarveMarketSnapshotV2(msg.sender);
        if (block.timestamp > deadline || receipts[msg.sender].liquidity != 0 || market.phase() != 1
            || market.token() != token || market.inventory() != inventory || msg.value != market.reserveETH()
            || msg.value != 4.2 ether || market.virtualETH() != 1.68 ether
            || CarveToken(token).totalSupply() != 1e27) revert InvalidMigration();
        CarveFeePolicy.validate(market.creatorFeeBps(), CREATOR_FEE_LIMIT_BPS);
        CarveMigrationMath.Plan memory plan = CarveMigrationMath.plan(inventory);
        if (plan.liquidity < minLiquidity) revert InvalidMigration();
        uint256 previousETH = address(this).balance - msg.value;
        uint256 previousTokens = CarveToken(token).balanceOf(address(this));
        if (!CarveToken(token).transferFrom(msg.sender, address(this), inventory)
            || CarveToken(token).balanceOf(address(this)) != previousTokens + inventory) revert TransferFailed();
        PoolKey memory key = keyForToken(token);
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (marketForPool[poolId] != address(0)) revert InvalidMigration();
        activeMigration = msg.sender;
        // Core skips beforeInitialize for a hook's own call. Authentication is enforced above;
        // all other initializers hit our always-reverting beforeInitialize callback.
        IPoolManager(poolManager).initialize(key, plan.sqrtPriceX96);
        callbackPending = true;
        bytes memory result = IPoolManager(poolManager).unlock(abi.encode(msg.sender));
        if (callbackPending) revert InvalidMigration();
        (uint256 spentETH, uint256 spentTokens) = abi.decode(result, (uint256, uint256));
        if (spentETH != plan.amount0 || spentTokens != plan.amount1
            || address(this).balance != previousETH + msg.value - spentETH
            || CarveToken(token).balanceOf(address(this)) != previousTokens + inventory - spentTokens)
            revert InvalidMigration();
        receipt = MigrationReceipt(poolId, plan.liquidity, spentETH, spentTokens,
            msg.value - spentETH, inventory - spentTokens);
        receipts[msg.sender] = receipt;
        marketForPool[poolId] = msg.sender;
        lockedPrincipal[address(0)] += receipt.lockedETH;
        lockedPrincipal[token] += receipt.lockedTokens;
        activeMigration = address(0);
        if (!verifyPosition(msg.sender)) revert InvalidMigration();
        emit Migrated(msg.sender, poolId, receipt.liquidity, spentETH, spentTokens,
            receipt.lockedETH, receipt.lockedTokens);
    }

    /// @dev Only one internally generated positive-liquidity operation is permitted per migration.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager) revert Unauthorized();
        Withdrawal memory claim = withdrawal;
        if (claim.amount != 0) {
            if (keccak256(data) != keccak256(abi.encode(claim))) revert Unauthorized();
            delete withdrawal;
            IPoolManager(poolManager).burn(address(this), uint160(claim.asset), claim.amount);
            IPoolManager(poolManager).take(Currency.wrap(claim.asset), claim.recipient, claim.amount);
            return "";
        }
        if (msg.sender != poolManager || !callbackPending || activeMigration == address(0)
            || abi.decode(data, (address)) != activeMigration) revert Unauthorized();
        callbackPending = false;
        ICarveMarketSnapshotV2 market = ICarveMarketSnapshotV2(activeMigration);
        address token = market.token();
        CarveMigrationMath.Plan memory plan = CarveMigrationMath.plan(market.inventory());
        (BalanceDelta delta, BalanceDelta fees) = IPoolManager(poolManager).modifyLiquidity(keyForToken(token),
            ModifyLiquidityParams(plan.tickLower, plan.tickUpper, int256(uint256(plan.liquidity)),
                bytes32(uint256(uint160(activeMigration)))), "");
        if (delta.amount0() >= 0 || delta.amount1() >= 0 || BalanceDelta.unwrap(fees) != 0) revert InvalidDelta();
        uint256 amount0 = uint256(-int256(delta.amount0()));
        uint256 amount1 = uint256(-int256(delta.amount1()));
        if (amount0 != plan.amount0 || amount1 != plan.amount1) revert InvalidDelta();
        IPoolManager(poolManager).sync(Currency.wrap(address(0)));
        if (IPoolManager(poolManager).settle{value: amount0}() != amount0) revert InvalidDelta();
        IPoolManager(poolManager).sync(Currency.wrap(token));
        if (!CarveToken(token).transfer(poolManager, amount1)) revert TransferFailed();
        if (IPoolManager(poolManager).settle() != amount1) revert InvalidDelta();
        return abi.encode(amount0, amount1);
    }

    /// @dev Only the engine can initialize its pools; core omits this callback for that self-call.
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert Unauthorized();
    }

    /// @notice Fees are paid in the unspecified currency: output for exact-in, input for exact-out.
    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external nonReentrant returns (bytes4, int128)
    {
        if (msg.sender != poolManager || activeMigration != address(0)) revert Unauthorized();
        address marketAddress = marketForPool[PoolId.unwrap(key.toId())];
        if (marketAddress == address(0)) revert Unauthorized();
        int256 nativeLeg = int256(delta.amount0());
        poolVolumeETH[Currency.unwrap(key.currency1)] += uint256(nativeLeg < 0 ? -nativeLeg : nativeLeg);
        ICarveMarketSnapshotV2 market = ICarveMarketSnapshotV2(marketAddress);
        bool exactIn = params.amountSpecified < 0;
        bool specifiedIs0 = exactIn == params.zeroForOne;
        int128 unspecified = specifiedIs0 ? delta.amount1() : delta.amount0();
        if (unspecified == 0) return (this.afterSwap.selector, 0);
        if ((exactIn && unspecified < 0) || (!exactIn && unspecified > 0)) revert InvalidDelta();
        uint256 base = uint256(exactIn ? int256(unspecified) : -int256(unspecified));
        uint256 gross = exactIn ? base : CarveFeePolicy.grossForNet(base, market.creatorFeeBps(), CREATOR_FEE_LIMIT_BPS);
        if (gross > uint256(uint128(type(int128).max))) revert InvalidFee();
        CarveFeePolicy.Amounts memory fee = CarveFeePolicy.fromGross(gross, market.creatorFeeBps(), CREATOR_FEE_LIMIT_BPS);
        if (exactIn && fee.net == 0) revert InvalidFee();
        uint256 total = fee.platformFee + fee.creatorFee;
        if (total > uint256(uint128(type(int128).max))) revert InvalidFee();
        Currency currency = specifiedIs0 ? key.currency1 : key.currency0;
        address asset = Currency.unwrap(currency);
        // Mint backed core claims instead of taking cash before the swapper has settled.
        // Returning the matching positive delta cancels the hook's debt in core.
        IPoolManager(poolManager).mint(address(this), uint160(asset), total);
        feeCredit[market.platformRecipient()][asset] += fee.platformFee;
        feeCredit[market.creator()][asset] += fee.creatorFee;
        totalFeeCredit[asset] += total;
        emit TradeFee(marketAddress, asset, fee.platformFee, fee.creatorFee);
        return (this.afterSwap.selector, int128(uint128(total)));
    }

    /// @notice Withdraw only the caller's trade-fee credit. Permanent principal is never withdrawable.
    function withdrawFees(address asset, address payable recipient) external nonReentrant {
        if (recipient == address(0) || recipient == address(this)) revert Unauthorized();
        uint256 amount = feeCredit[msg.sender][asset];
        if (amount == 0) revert NoCredit();
        if (amount > uint256(uint128(type(int128).max))) amount = uint256(uint128(type(int128).max));
        feeCredit[msg.sender][asset] -= amount;
        totalFeeCredit[asset] -= amount;
        if (IPoolManager(poolManager).balanceOf(address(this), uint160(asset)) < totalFeeCredit[asset] + amount)
            revert InvalidFee();
        withdrawal = Withdrawal(asset, recipient, amount);
        IPoolManager(poolManager).unlock(abi.encode(withdrawal));
        if (withdrawal.amount != 0) revert InvalidFee();
        emit FeeWithdrawn(msg.sender, asset, recipient, amount);
    }
}
