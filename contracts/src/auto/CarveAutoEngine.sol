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
import {CarveBuybackPolicy} from "../CarveBuybackPolicy.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
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
interface ICarveAutoFactoryRegistry {
    function isMarket(address market) external view returns (bool);
    function marketForToken(address token) external view returns (address);
}

interface ICarveAutoMarketSnapshot {
    function token() external view returns (address);
    function creator() external view returns (address);
    function autoBuyback() external view returns (bool);
    function pendingBuybackETH() external view returns (uint256);
    function releaseBuybackToEngine() external returns (uint256);
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
contract CarveAutoEngine is ICarveMigrationAdapterV2 {
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
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MIN_BUYBACK = 0.00001 ether;
    uint256 public constant MAX_BUYBACK = 0.002 ether;
    mapping(address => uint256) public pendingBuybackETH;
    mapping(address => uint256) public pendingBurnTokens;
    mapping(address => uint256) public totalBuybackETH;
    mapping(address => uint256) public totalTokensBurned;
    address private receivingFromMarket;
    event AutoBuyback(address indexed market, uint256 ethSpent, uint256 tokensLocked);
    event BuybackDeferred(address indexed market);
    error BuybackGasRequired();
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

    receive() external payable { if (msg.sender != poolManager && msg.sender != POSITION_MANAGER && msg.sender != receivingFromMarket) revert Unauthorized(); }

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
        ICarveAutoFactoryRegistry f = ICarveAutoFactoryRegistry(factory);
        if (!f.isMarket(msg.sender) || f.marketForToken(token) != msg.sender) revert Unauthorized();
        ICarveAutoMarketSnapshot market = ICarveAutoMarketSnapshot(msg.sender);
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
        ICarveAutoMarketSnapshot market = ICarveAutoMarketSnapshot(marketAddress);
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
        totalFeeCredit[asset] += fee.platformFee;
        _creditCreator(marketAddress, asset, fee.creatorFee);
        emit TradeFee(marketAddress, asset, fee.platformFee, fee.creatorFee);
        _tryBuyback(marketAddress);
        return (this.afterSwap.selector, int128(uint128(total)));
    }

    function _creditCreator(address marketAddress, address asset, uint256 amount) private {
        ICarveAutoMarketSnapshot market = ICarveAutoMarketSnapshot(marketAddress);
        uint256 revenue = amount;
        if (market.autoBuyback()) {
            uint256 budget;
            (revenue, budget) = CarveBuybackPolicy.split(amount);
            if (asset == address(0)) pendingBuybackETH[marketAddress] += budget;
            else pendingBurnTokens[marketAddress] += budget;
        }
        feeCredit[market.creator()][asset] += revenue;
        totalFeeCredit[asset] += revenue;
    }

    function _tryBuyback(address marketAddress) private {
        ICarveAutoMarketSnapshot market = ICarveAutoMarketSnapshot(marketAddress);
        if (!market.autoBuyback()) return;
        if (pendingBurnTokens[marketAddress] == 0 &&
            pendingBuybackETH[marketAddress] + market.pendingBuybackETH() < MIN_BUYBACK) return;
        if (gasleft() < 600_000) revert BuybackGasRequired();
        try this.processBuyback{gas: 450_000}(marketAddress) {} catch { emit BuybackDeferred(marketAddress); }
    }

    /// @dev Runs only inside our fee hook, with core already unlocked. Core skips
    /// a hook's own callbacks, avoiding recursion; explicit fee accounting below
    /// preserves the platform fee. No public caller can choose token or slippage.
    function processBuyback(address marketAddress) external {
        if (msg.sender != address(this)) revert Unauthorized();
        ICarveAutoMarketSnapshot market = ICarveAutoMarketSnapshot(marketAddress);
        address token = market.token();
        IPoolManager manager = IPoolManager(poolManager);
        receivingFromMarket = marketAddress;
        uint256 released = market.releaseBuybackToEngine();
        receivingFromMarket = address(0);
        if (released != 0) {
            manager.sync(Currency.wrap(address(0)));
            if (manager.settle{value:released}() != released) revert InvalidFee();
            manager.mint(address(this), 0, released);
            pendingBuybackETH[marketAddress] += released;
        }
        uint256 tokenFees = pendingBurnTokens[marketAddress];
        if (tokenFees != 0) {
            pendingBurnTokens[marketAddress] = 0;
            manager.burn(address(this), uint160(token), tokenFees);
            manager.take(Currency.wrap(token), BURN_ADDRESS, tokenFees);
            totalTokensBurned[marketAddress] += tokenFees;
            emit AutoBuyback(marketAddress, 0, tokenFees);
        }
        PoolKey memory key = keyForToken(token);
        (uint160 sqrtPrice,,,) = manager.getSlot0(key.toId());
        uint128 liquidity = manager.getLiquidity(key.toId());
        uint256 amount = pendingBuybackETH[marketAddress];
        if (amount > MAX_BUYBACK) amount = MAX_BUYBACK;
        // Limit each purchase to 0.1% of the virtual native reserve.
        uint256 impactCap = FullMath.mulDiv(liquidity, uint256(1) << 96, sqrtPrice) / 1000;
        if (amount > impactCap) amount = impactCap;
        if (amount < MIN_BUYBACK) return;
        CarveFeePolicy.Amounts memory fee = CarveFeePolicy.fromGross(amount, market.creatorFeeBps(), CREATOR_FEE_LIMIT_BPS);
        uint160 limit = uint160(uint256(sqrtPrice) * 995 / 1000);
        if (limit <= TickMath.MIN_SQRT_PRICE) return;
        uint256 spotOut = FullMath.mulDiv(fee.net, sqrtPrice, uint256(1) << 96);
        spotOut = FullMath.mulDiv(spotOut, sqrtPrice, uint256(1) << 96);
        uint256 minimum = spotOut * 99 / 100;
        if (minimum == 0) return;
        BalanceDelta delta = manager.swap(key, SwapParams(true, -int256(fee.net), limit), "");
        if (delta.amount0() >= 0 || delta.amount1() <= 0
            || uint256(-int256(delta.amount0())) != fee.net || uint256(int256(delta.amount1())) < minimum)
            revert InvalidDelta();
        uint256 output = uint256(int256(delta.amount1()));
        pendingBuybackETH[marketAddress] -= amount;
        manager.burn(address(this), 0, fee.net);
        manager.take(Currency.wrap(token), BURN_ADDRESS, output);
        feeCredit[market.platformRecipient()][address(0)] += fee.platformFee;
        totalFeeCredit[address(0)] += fee.platformFee;
        _creditCreator(marketAddress, address(0), fee.creatorFee);
        poolVolumeETH[token] += fee.net;
        emit TradeFee(marketAddress, address(0), fee.platformFee, fee.creatorFee);
        totalBuybackETH[marketAddress] += amount;
        totalTokensBurned[marketAddress] += output;
        emit AutoBuyback(marketAddress, amount, output);
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
