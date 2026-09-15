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
import {CarveToken} from "../CarveToken.sol";
import {CarveMigrationMath} from "../CarveMigrationMath.sol";
import {CarveFeePolicy} from "../CarveFeePolicy.sol";
import {ICarveMigrationAdapterV2} from "../interfaces/ICarveMigrationAdapterV2.sol";

/// @dev Minimal ABI of the pinned canonical V4 PositionManager and Permit2.
interface ICarvePositionManager {
    function poolManager() external view returns (address);
    function permit2() external view returns (address);
    function nextTokenId() external view returns (uint256);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256);
}
interface ICarvePermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}
interface ICarveCurveFactoryRegistry {
    function isMarket(address market) external view returns (bool);
    function marketForToken(address token) external view returns (address);
}

interface ICarveCurveMarketSnapshot {
    function token() external view returns (address);
    function creator() external view returns (address);
    function platformRecipient() external view returns (address);
    function creatorFeeBps() external view returns (uint16);
    function reserveETH() external view returns (uint256);
    function inventory() external view returns (uint256);
    function virtualETH() external view returns (uint256);
    function phase() external view returns (uint8);
}

/// @notice Immutable v4 migration, permanent canonical position-NFT custody and trade-fee hook.
/// @dev No position-removal, owner, sweep, arbitrary call, router, or upgrade entry point.
///      A separate router executes swaps: v4 intentionally skips callbacks on a hook's own swaps.
///      Zero LP fee; the canonical protocol fee controller remains outside Carve's control.
contract CarveCurveEngine is ICarveMigrationAdapterV2 {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address public constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    bytes32 public constant POSITION_MANAGER_CODE_HASH =
        0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    mapping(address => uint256) public positionForMarket;
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
        if (POSITION_MANAGER.codehash != POSITION_MANAGER_CODE_HASH || PERMIT2.code.length == 0
            || ICarvePositionManager(POSITION_MANAGER).poolManager() != poolManager_
            || ICarvePositionManager(POSITION_MANAGER).permit2() != PERMIT2) revert InvalidDependency();
        poolManager = poolManager_;
        factory = factory_;
    }

    receive() external payable { if (msg.sender != poolManager && msg.sender != POSITION_MANAGER) revert Unauthorized(); }

    function keyForToken(address token) public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(token), 0, 200, IHooks(address(this)));
    }

    function getReceipt(address market) external view returns (MigrationReceipt memory) { return receipts[market]; }

    function verifyPosition(address market) public view returns (bool) {
        MigrationReceipt memory receipt = receipts[market];
        if (receipt.liquidity == 0 || marketForPool[receipt.poolId] != market) return false;
        uint256 id = positionForMarket[market];
        ICarvePositionManager positions = ICarvePositionManager(POSITION_MANAGER);
        if (id == 0 || positions.ownerOf(id) != address(this)) return false;
        (PoolKey memory key, uint256 info) = positions.getPoolAndPositionInfo(id);
        if (PoolId.unwrap(key.toId()) != receipt.poolId || int24(uint24(info >> 8)) != -887200
            || int24(uint24(info >> 32)) != 887200) return false;
        return positions.getPositionLiquidity(id) == receipt.liquidity;
    }

    function migrate(address token, uint256 inventory, uint128 minLiquidity, uint256 deadline)
        external payable nonReentrant returns (MigrationReceipt memory receipt)
    {
        ICarveCurveFactoryRegistry f = ICarveCurveFactoryRegistry(factory);
        if (!f.isMarket(msg.sender) || f.marketForToken(token) != msg.sender) revert Unauthorized();
        ICarveCurveMarketSnapshot market = ICarveCurveMarketSnapshot(msg.sender);
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
        ICarvePositionManager positions = ICarvePositionManager(POSITION_MANAGER);
        uint256 positionId = positions.nextTokenId();
        if (positionId == 0) revert InvalidMigration();
        if (!CarveToken(token).approve(PERMIT2, plan.amount1Max)) revert TransferFailed();
        ICarvePermit2(PERMIT2).approve(token, POSITION_MANAGER, uint160(plan.amount1Max), uint48(block.timestamp));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(key, plan.tickLower, plan.tickUpper, uint256(plan.liquidity),
            plan.amount0Max, plan.amount1Max, address(this), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        params[2] = abi.encode(key.currency0, address(this));
        // Canonical actions: MINT_POSITION (02), SETTLE_PAIR (0d), SWEEP (14).
        positions.modifyLiquidities{value: msg.value}(abi.encode(hex"020d14", params), deadline);
        ICarvePermit2(PERMIT2).approve(token, POSITION_MANAGER, 0, 0);
        if (!CarveToken(token).approve(PERMIT2, 0)) revert TransferFailed();
        if (positions.nextTokenId() != positionId + 1 || positions.ownerOf(positionId) != address(this))
            revert InvalidMigration();
        uint256 spentETH = previousETH + msg.value - address(this).balance;
        uint256 spentTokens = previousTokens + inventory - CarveToken(token).balanceOf(address(this));
        positionForMarket[msg.sender] = positionId;
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

    /// @dev Only authenticated fee-credit withdrawals may unlock through this callback.
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
        revert Unauthorized();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != POSITION_MANAGER) revert Unauthorized();
        return this.onERC721Received.selector;
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
        ICarveCurveMarketSnapshot market = ICarveCurveMarketSnapshot(marketAddress);
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

