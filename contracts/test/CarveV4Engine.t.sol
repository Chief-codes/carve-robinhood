// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CarveContentRegistry} from "../src/CarveContentRegistry.sol";
import {CarveFactoryV2} from "../src/CarveFactoryV2.sol";
import {CarveMarketV2} from "../src/CarveMarketV2.sol";
import {CarveToken} from "../src/CarveToken.sol";
import {CarveV4Engine} from "../src/CarveV4Engine.sol";
import {CarveV4Router} from "../src/CarveV4Router.sol";
import {CarveDeployment} from "../src/CarveDeployment.sol";
import {CarveMigrationMath} from "../src/CarveMigrationMath.sol";
import {ICarveMigrationAdapterV2} from "../src/interfaces/ICarveMigrationAdapterV2.sol";

interface EngineVm {
    struct Log { bytes32[] topics; bytes data; address emitter; }
    function etch(address target, bytes calldata code) external;
    function deal(address account, uint256 balance) external;
    function readFile(string calldata path) external view returns (string memory);
    function parseBytes(string calldata value) external pure returns (bytes memory);
    function getNonce(address account) external view returns (uint64);
    function prank(address caller) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function mockCall(address target, bytes calldata data, bytes calldata result) external;
    function clearMockedCalls() external;
    function skip(bool condition) external;
    function chainId(uint256 newChainId) external;
}

interface CanonicalV4Quoter {
    struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }
    function poolManager() external view returns (address);
    function quoteExactInputSingle(QuoteExactSingleParams memory params) external returns (uint256, uint256);
    function quoteExactOutputSingle(QuoteExactSingleParams memory params) external returns (uint256, uint256);
}

/// @dev Test-only external swap payer. Exercises real PoolManager swap/settlement,
///      with the engine as hook and this distinct address as swap initiator.
contract CanonicalCoreSwapHarness {
    IPoolManager public immutable manager;
    constructor(IPoolManager manager_) { manager = manager_; }
    receive() external payable {}

    function swap(PoolKey memory key, SwapParams memory params) external payable returns (BalanceDelta delta) {
        delta = BalanceDelta.wrap(abi.decode(manager.unlock(abi.encode(uint8(0), key, params, msg.sender)), (int256)));
        if (address(this).balance != 0) {
            (bool ok,) = msg.sender.call{value: address(this).balance}("");
            require(ok, "test refund");
        }
    }

    function removeAnotherOwnerPosition(PoolKey memory key, bytes32 salt, uint128 liquidity) external {
        manager.unlock(abi.encode(uint8(1), key, salt, liquidity));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "test callback caller");
        uint8 mode = abi.decode(data, (uint8));
        if (mode == 1) {
            (, PoolKey memory removalKey, bytes32 salt, uint128 liquidity) = abi.decode(data, (uint8, PoolKey, bytes32, uint128));
            manager.modifyLiquidity(removalKey, ModifyLiquidityParams(-887200, 887200, -int256(uint256(liquidity)), salt), "");
            return "";
        }
        (, PoolKey memory key, SwapParams memory params, address payer) =
            abi.decode(data, (uint8, PoolKey, SwapParams, address));
        BalanceDelta delta = manager.swap(key, params, "");
        _settle(key.currency0, delta.amount0(), payer);
        _settle(key.currency1, delta.amount1(), payer);
        return abi.encode(BalanceDelta.unwrap(delta));
    }

    function _settle(Currency currency, int128 delta, address payer) private {
        if (delta > 0) manager.take(currency, payer, uint256(uint128(delta)));
        else if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            manager.sync(currency);
            if (Currency.unwrap(currency) == address(0)) require(manager.settle{value: amount}() == amount, "native settle");
            else {
                require(CarveToken(Currency.unwrap(currency)).transferFrom(payer, address(manager), amount), "test transfer");
                require(manager.settle() == amount, "token settle");
            }
        }
    }
}

contract RejectEngineFeeReceiver { receive() external payable { revert("reject"); } }

/// @notice Canonical core integration, using an existing fork or the verified local runtime fixture.
/// @dev A fork's existing PoolManager is never replaced. Without a fork, storage starts empty.
contract CarveV4EngineTest {
    EngineVm private constant vm = EngineVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CANONICAL_PM = address(uint160(0x008366a39cc670b4001a1121b8f6a443a643e40951));
    address private constant PLATFORM = address(0xCA12E);
    bytes32 private constant RUNTIME_HASH = 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    bytes32 private constant SWAP_EVENT = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    IPoolManager private manager;
    CarveContentRegistry private registry;
    CarveFactoryV2 private factory;
    CarveV4Engine private engine;
    CarveMarketV2 private market;
    CarveToken private token;
    CanonicalCoreSwapHarness private swapper;
    CarveV4Router private productionRouter;
    bytes32 private imageRoot;

    receive() external payable {}

    function setUp() public {
        bytes memory hexText = bytes(vm.readFile("test/fixtures/PoolManager-4663-runtime.hex"));
        while (hexText.length != 0 && uint8(hexText[hexText.length - 1]) <= 32) {
            assembly ("memory-safe") { mstore(hexText, sub(mload(hexText), 1)) }
        }
        bytes memory runtime = vm.parseBytes(string(hexText));
        require(runtime.length == 24009 && keccak256(runtime) == RUNTIME_HASH, "verified runtime fixture");
        if (CANONICAL_PM.code.length == 0) vm.etch(CANONICAL_PM, runtime);
        require(CANONICAL_PM.codehash == RUNTIME_HASH, "canonical existing runtime or fixture must match");
        manager = IPoolManager(CANONICAL_PM);
        vm.deal(address(this), 100 ether);
        registry = new CarveContentRegistry();
        uint64 factoryNonce = vm.getNonce(address(this)) + 1;
        require(factoryNonce > 0 && factoryNonce < 128, "simple create prediction");
        address predictedFactory = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), uint8(factoryNonce))))));
        bytes32 initHash = keccak256(abi.encodePacked(type(CarveV4Engine).creationCode, abi.encode(CANONICAL_PM, predictedFactory)));
        bytes32 salt = _mineSalt(initHash);
        engine = new CarveV4Engine{salt: salt}(CANONICAL_PM, predictedFactory);
        factory = new CarveFactoryV2(registry, PLATFORM, address(engine));
        require(address(factory) == predictedFactory && engine.factory() == address(factory), "factory wiring");
        swapper = new CanonicalCoreSwapHarness(manager);
        productionRouter = new CarveV4Router(engine);
        (address pointer, bytes32 chunkHash) = registry.writeChunk(hex"89504e47");
        address[] memory pointers = new address[](1); pointers[0] = pointer;
        bytes32[] memory hashes = new bytes32[](1); hashes[0] = chunkHash;
        imageRoot = registry.registerContent("image/png", "identity", 4, pointers, hashes);
        _launchCurveMarket(200);
    }

    function _mineSalt(bytes32 initHash) private view returns (bytes32 salt) {
        return _mineSaltFor(address(this), initHash);
    }

    function _mineSaltFor(address deployer, bytes32 initHash) private pure returns (bytes32 salt) {
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            address candidate = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initHash)))));
            if ((uint160(candidate) & 0x3fff) == 0x2044) return salt;
        }
    }

    function _launchCurveMarket(uint16 creatorBps) private {
        (address tokenAddress, address marketAddress) = factory.launch{value: 0.0005 ether}(
            "Canonical Core Test", "CORE", imageRoot, 0, 0, creatorBps, 0, block.timestamp
        );
        market = CarveMarketV2(payable(marketAddress));
        token = CarveToken(tokenAddress);
        token.approve(address(swapper), type(uint256).max);
        token.approve(address(productionRouter), type(uint256).max);
    }

    function _graduate() private returns (ICarveMigrationAdapterV2.MigrationReceipt memory receipt) {
        market.buy{value: 5 ether}(1, block.timestamp);
        require(uint8(market.phase()) == 2, "crossing buy automatically graduates");
        receipt = market.graduationReceipt();
        require(engine.verifyPosition(address(market)), "canonical position receipt");
    }

    function testMigrationCreatesPermanentCanonicalPositionAndSegregatesEscrow() public {
        uint256 oldEscrow = market.totalPendingETH();
        uint256 oldInventory = market.inventory();
        (uint256 crossingTokens,, uint256 crossingPlatformFee, uint256 crossingCreatorFee, uint256 crossingRefund) = market.quoteBuy(5 ether);
        oldEscrow += crossingPlatformFee + crossingCreatorFee + crossingRefund;
        oldInventory -= crossingTokens;
        ICarveMigrationAdapterV2.MigrationReceipt memory r = _graduate();
        require(uint8(market.phase()) == 2 && market.reserveETH() == 0 && market.inventory() == 0, "graduated state");
        require(r.ethSpent + r.lockedETH == 4.2 ether && r.tokensSpent + r.lockedTokens == oldInventory, "principal conservation");
        require(address(engine).balance == r.lockedETH && token.balanceOf(address(engine)) == r.lockedTokens, "locked dust");
        require(engine.lockedPrincipal(address(0)) == r.lockedETH && engine.lockedPrincipal(address(token)) == r.lockedTokens, "principal ledger");
        require(address(market).balance == oldEscrow && market.totalPendingETH() == oldEscrow, "curve escrow preserved");
        require(token.allowance(address(market), address(engine)) == 0, "approval cleared");
        require(engine.totalFeeCredit(address(0)) == 0 && engine.totalFeeCredit(address(token)) == 0, "principal is not fees");
        require(engine.poolVolumeETH(address(token)) == 0, "migration liquidity is not trading volume");
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.graduate(1, block.timestamp);
    }

    function testExactInputETHToTokenChargesTokenOutput() public { _graduate(); _assertSwapFees(true, true); }
    function testExactInputTokenToETHChargesETHOutput() public { _graduate(); _assertSwapFees(false, true); }
    function testExactOutputTokenChargesAdditionalETHInput() public { _graduate(); _assertSwapFees(true, false); }
    function testExactOutputETHChargesAdditionalTokenInput() public { _graduate(); _assertSwapFees(false, false); }

    function testLargeExactOutputAccruesClaimsBeforeInputSettlement() public {
        ICarveMigrationAdapterV2.MigrationReceipt memory r = _graduate();
        uint256 oldPoolETH = CANONICAL_PM.balance;
        uint256 wantedTokens = r.tokensSpent * 99 / 100;
        vm.deal(address(this), 2000 ether);
        BalanceDelta result = swapper.swap{value: 1000 ether}(engine.keyForToken(address(token)),
            SwapParams(true, int256(wantedTokens), TickMath.MIN_SQRT_PRICE + 1));
        uint256 fee = engine.totalFeeCredit(address(0));
        require(uint256(uint128(result.amount1())) == wantedTokens, "exact requested token output");
        require(fee > oldPoolETH, "fee exceeds cash held before payer settles");
        require(manager.balanceOf(address(engine), 0) == fee, "fee represented as claims without early cash take");
        require(engine.verifyPosition(address(market)), "large swap preserves permanent liquidity");
    }

    function testPriceLimitedPartialFillChargesOnlyActualOutput() public {
        ICarveMigrationAdapterV2.MigrationReceipt memory r = _graduate();
        CarveMigrationMath.Plan memory p = CarveMigrationMath.plan(r.tokensSpent + r.lockedTokens);
        uint160 limit = uint160(uint256(p.sqrtPriceX96) * 999 / 1000);
        vm.recordLogs();
        BalanceDelta result = swapper.swap{value: 1 ether}(engine.keyForToken(address(token)),
            SwapParams(true, -int256(1 ether), limit));
        (int128 raw0, int128 raw1) = _poolSwapDelta(vm.getRecordedLogs());
        require(raw0 < 0 && -int256(raw0) < 1 ether && raw1 > 0, "core price limit actually partially filled");
        uint256 fee = (uint256(uint128(raw1)) * 300 + 9999) / 10000;
        require(result.amount0() == raw0 && int256(result.amount1()) == int256(raw1) - int256(fee), "fee uses actual fill");
        require(manager.balanceOf(address(engine), uint160(address(token))) == fee, "partial fill claims exact");
    }

    function _assertSwapFees(bool zeroForOne, bool exactIn) private {
        uint256 oldVolume = engine.poolVolumeETH(address(token));
        bool specifiedIs0 = exactIn == zeroForOne;
        address asset = specifiedIs0 ? address(token) : address(0);
        uint256 oldClaims = manager.balanceOf(address(engine), uint160(asset));
        uint256 oldPlatform = engine.feeCredit(PLATFORM, asset);
        uint256 oldCreator = engine.feeCredit(address(this), asset);
        int256 amount = exactIn ? -int256(uint256(zeroForOne ? 0.05 ether : 1e24)) : int256(uint256(zeroForOne ? 1e24 : 0.01 ether));
        SwapParams memory params = SwapParams(zeroForOne, amount,
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);
        vm.recordLogs();
        BalanceDelta result = swapper.swap{value: zeroForOne ? 1 ether : 0}(engine.keyForToken(address(token)), params);
        EngineVm.Log[] memory logs = vm.getRecordedLogs();
        (int128 raw0, int128 raw1) = _poolSwapDelta(logs);
        require(engine.poolVolumeETH(address(token)) - oldVolume == uint256(raw0 < 0 ? -int256(raw0) : int256(raw0)),
            "each exactness/direction counts only absolute pre-hook native pool leg");
        int128 raw = specifiedIs0 ? raw1 : raw0;
        int128 actual = specifiedIs0 ? result.amount1() : result.amount0();
        uint256 base = uint256(exactIn ? int256(raw) : -int256(raw));
        uint256 netBps = 10_000 - 100 - market.creatorFeeBps();
        uint256 gross = exactIn ? base : (base * 10_000 + netBps - 1) / netBps;
        uint256 total = (gross * (100 + market.creatorFeeBps()) + 9_999) / 10_000;
        uint256 platformFee = (gross + 99) / 100;
        require(int256(actual) == int256(raw) - int256(total), "core applies positive unspecified fee");
        require(specifiedIs0 ? result.amount0() == raw0 : result.amount1() == raw1, "specified leg unchanged");
        require(engine.feeCredit(PLATFORM, asset) - oldPlatform == platformFee, "fixed platform fee");
        require(engine.feeCredit(address(this), asset) - oldCreator == total - platformFee, "separate creator fee");
        require(manager.balanceOf(address(engine), uint160(asset)) - oldClaims == total, "minted claims exactly back fee");
        require(manager.balanceOf(address(engine), uint160(asset)) == engine.totalFeeCredit(asset), "claims cover aggregate credit");
        require(engine.verifyPosition(address(market)), "swap cannot reduce position liquidity");
    }

    function _poolSwapDelta(EngineVm.Log[] memory logs) private pure returns (int128 raw0, int128 raw1) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == CANONICAL_PM && logs[i].topics[0] == SWAP_EVENT) {
                (raw0, raw1,,,,) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                return (raw0, raw1);
            }
        }
        revert("missing actual core swap event");
    }

    function testZeroAndMaximumCreatorFeesWithRealCore() public {
        _launchCurveMarket(0); _graduate(); _assertSwapFees(true, true); _assertSwapFees(false, false);
        require(engine.feeCredit(address(this), address(token)) == 0, "zero creator remains zero");
        _launchCurveMarket(1000); _graduate(); _assertSwapFees(true, false); _assertSwapFees(false, true);
    }

    function testFeeClaimBurnTakePreservesPrincipalAndDonations() public {
        ICarveMigrationAdapterV2.MigrationReceipt memory r = _graduate();
        _assertSwapFees(true, true); _assertSwapFees(false, true);
        token.transfer(address(engine), 1e18);
        vm.deal(address(engine), address(engine).balance + 0.25 ether);
        address payable recipient = payable(address(0xBEEF));
        uint256 nativeCredit = engine.feeCredit(PLATFORM, address(0));
        uint256 tokenCredit = engine.feeCredit(PLATFORM, address(token));
        uint256 recipientETHBefore = recipient.balance;
        uint256 volumeBefore = engine.poolVolumeETH(address(token));
        vm.prank(PLATFORM); engine.withdrawFees(address(0), recipient);
        vm.prank(PLATFORM); engine.withdrawFees(address(token), recipient);
        require(recipient.balance == recipientETHBefore + nativeCredit && token.balanceOf(recipient) == tokenCredit, "actual recipient payment");
        require(engine.feeCredit(PLATFORM, address(0)) == 0 && engine.feeCredit(PLATFORM, address(token)) == 0, "credit consumed");
        require(manager.balanceOf(address(engine), 0) == engine.totalFeeCredit(address(0)), "remaining ETH claims");
        require(manager.balanceOf(address(engine), uint160(address(token))) == engine.totalFeeCredit(address(token)), "remaining token claims");
        require(address(engine).balance == r.lockedETH + 0.25 ether && token.balanceOf(address(engine)) == r.lockedTokens + 1e18, "principal and donations untouched");
        require(engine.verifyPosition(address(market)), "LP position unchanged after claims");
        require(engine.poolVolumeETH(address(token)) == volumeBefore, "fee withdrawals and donations do not add volume");
        vm.prank(address(0xBAD)); vm.expectRevert(CarveV4Engine.NoCredit.selector);
        engine.withdrawFees(address(0), payable(address(0xBAD)));
    }

    function testRejectingRecipientCannotDestroyFeeCredit() public {
        _graduate(); _assertSwapFees(false, true);
        RejectEngineFeeReceiver rejecting = new RejectEngineFeeReceiver();
        uint256 beforeCredit = engine.feeCredit(PLATFORM, address(0));
        uint256 beforeClaims = manager.balanceOf(address(engine), 0);
        vm.prank(PLATFORM); vm.expectRevert(); engine.withdrawFees(address(0), payable(address(rejecting)));
        require(engine.feeCredit(PLATFORM, address(0)) == beforeCredit && manager.balanceOf(address(engine), 0) == beforeClaims, "failed payout fully rolls back");
        vm.prank(PLATFORM); engine.withdrawFees(address(0), payable(address(0xBEEF)));
    }

    function testOutsiderInitializationAndDirectCallbacksRejected() public {
        PoolKey memory key = engine.keyForToken(address(token));
        vm.expectRevert(); manager.initialize(key, uint160(1) << 96);
        vm.expectRevert(CarveV4Engine.Unauthorized.selector); engine.beforeInitialize(address(this), key, uint160(1) << 96);
        vm.expectRevert(CarveV4Engine.Unauthorized.selector); engine.unlockCallback(abi.encode(address(market)));
        vm.expectRevert(CarveV4Engine.Unauthorized.selector);
        engine.afterSwap(address(this), key, SwapParams(true, -1, TickMath.MIN_SQRT_PRICE + 1), BalanceDelta.wrap(0), "");
        _graduate();
    }

    function testCorePositionOwnerCannotBeSpoofedBySameSalt() public {
        ICarveMigrationAdapterV2.MigrationReceipt memory r = _graduate();
        PoolKey memory key = engine.keyForToken(address(token));
        vm.expectRevert();
        swapper.removeAnotherOwnerPosition(key, bytes32(uint256(uint160(address(market)))), r.liquidity);
        require(engine.verifyPosition(address(market)), "other core caller cannot withdraw engine LP");
    }

    function testNativeSyncResetsPriorUnrelatedCurrency() public {
        manager.sync(Currency.wrap(address(token)));
        _graduate();
    }

    function testSettlementFailureRollsBackInitializationPhaseAndApprovals() public {
        uint256 balanceBefore = address(market).balance;
        uint256 inventoryBefore = market.inventory();
        vm.mockCall(CANONICAL_PM, abi.encodeWithSelector(IPoolManager.settle.selector), abi.encode(uint256(0)));
        vm.expectRevert(); market.buy{value: 5 ether}(1, block.timestamp);
        vm.clearMockedCalls();
        require(uint8(market.phase()) == 0 && market.reserveETH() == 0, "phase and reserve rolled back");
        require(market.curveVolumeETH() == 0 && engine.poolVolumeETH(address(token)) == 0, "failed auto-graduation rolls back volume");
        require(market.inventory() == inventoryBefore && token.balanceOf(address(market)) == inventoryBefore, "inventory rolled back");
        require(address(market).balance == balanceBefore && token.allowance(address(market), address(engine)) == 0, "ETH and allowance rolled back");
        _graduate();
    }

    function testFactoryInitialCapBuyAutomaticallyGraduates() public {
        (address tokenAddress, address marketAddress) = factory.launch{value: 5.0005 ether}(
            "Atomic Launch Test", "AUTO", imageRoot, 0, 0, 200, 1, block.timestamp
        );
        CarveMarketV2 launched = CarveMarketV2(payable(marketAddress));
        require(uint8(launched.phase()) == 2 && launched.reserveETH() == 0 && launched.inventory() == 0, "initial cap buy migrated");
        require(engine.verifyPosition(marketAddress), "initial cap buy canonical position");
        require(factory.isMarket(marketAddress) && factory.marketForToken(tokenAddress) == marketAddress, "registered before migration");
        require(CarveToken(tokenAddress).balanceOf(address(this)) != 0, "initial buyer received tokens");
    }

    function testInitialCapLaunchSettlementFailureRollsBackFactoryRegistration() public {
        uint256 countBefore = factory.marketCount();
        uint256 platformBefore = factory.pendingETH(PLATFORM);
        vm.mockCall(CANONICAL_PM, abi.encodeWithSelector(IPoolManager.settle.selector), abi.encode(uint256(0)));
        vm.expectRevert();
        factory.launch{value: 5.0005 ether}("Reverted Launch", "REV", imageRoot, 0, 0, 200, 1, block.timestamp);
        vm.clearMockedCalls();
        require(factory.marketCount() == countBefore && factory.pendingETH(PLATFORM) == platformBefore, "failed launch fully atomic");
    }

    function testProductionRouterAllFourModesAndFeeInclusion() public {
        _graduate();
        _assertProductionSwap(true, true);
        _assertProductionSwap(false, true);
        _assertProductionSwap(true, false);
        _assertProductionSwap(false, false);
    }

    function _assertProductionSwap(bool buy, bool exactInput) private {
        uint256 oldVolume = engine.poolVolumeETH(address(token));
        uint256 specified = exactInput ? (buy ? 0.05 ether : 1e24) : (buy ? 1e24 : 0.01 ether);
        uint256 maximum = buy ? 1 ether : 1e24;
        uint256 nativeCreditBefore = productionRouter.pendingETH(address(this));
        uint256 tokensBefore = token.balanceOf(address(this));
        uint256 input;
        uint256 output;
        vm.recordLogs();
        if (exactInput) (input, output) = productionRouter.swapExactInput{value: buy ? specified : 0}(
            address(token), buy, specified, 1, 0, block.timestamp);
        else (input, output) = productionRouter.swapExactOutput{value: buy ? maximum : 0}(
            address(token), buy, specified, maximum, 0, block.timestamp);
        (int128 pool0, int128 pool1) = _poolSwapDelta(vm.getRecordedLogs());
        require(engine.poolVolumeETH(address(token)) - oldVolume == uint256(pool0 < 0 ? -int256(pool0) : int256(pool0)),
            "production router volume uses pre-hook native leg in all four modes");
        int128 rawUnspecified = exactInput ? (buy ? pool1 : pool0) : (buy ? pool0 : pool1);
        uint256 base = uint256(exactInput ? int256(rawUnspecified) : -int256(rawUnspecified));
        uint256 gross = exactInput ? base : (base * 10000 + 9699) / 9700;
        uint256 fee = (gross * 300 + 9999) / 10000;
        require(exactInput ? output == base - fee : input == base + fee, "production output/input includes hook fee");
        require(exactInput ? input == specified : output == specified, "specified amount fulfilled");
        if (buy) {
            require(token.balanceOf(address(this)) == tokensBefore + output, "buy tokens delivered to payer");
            require(productionRouter.pendingETH(address(this)) == nativeCreditBefore + (exactInput ? specified : maximum) - input, "only unspent buy ETH credited");
        } else {
            require(token.balanceOf(address(this)) == tokensBefore - input, "only actual seller input pulled");
            require(productionRouter.pendingETH(address(this)) == nativeCreditBefore + output, "seller output credited");
        }
        require(address(productionRouter).balance >= productionRouter.totalPendingETH(), "production router solvent");
        require(engine.verifyPosition(address(market)), "production trade preserves LP custody");
    }

    function testProductionRouterWithdrawalsNeverConsumeDonationsOrOthersCredits() public {
        _graduate();
        vm.deal(address(productionRouter), 0.4 ether);
        token.transfer(address(productionRouter), 1e18);
        _assertProductionSwap(true, false);
        _assertProductionSwap(false, true);
        uint256 credit = productionRouter.pendingETH(address(this));
        address payable recipient = payable(address(0xBEEF));
        uint256 beforeRecipient = recipient.balance;
        productionRouter.withdrawETH(recipient);
        require(recipient.balance == beforeRecipient + credit, "router pays caller-owned credits");
        require(address(productionRouter).balance == 0.4 ether && token.balanceOf(address(productionRouter)) == 1e18, "router donations inaccessible");
        require(productionRouter.pendingETH(address(this)) == 0 && productionRouter.totalPendingETH() == 0, "router liabilities discharged");
        vm.prank(address(0xBAD)); vm.expectRevert(); productionRouter.withdrawETH(payable(address(0xBAD)));
    }

    function testProductionRouterSlippageAndCallbackFailuresRollBackFees() public {
        _graduate();
        uint256 nativeFeesBefore = engine.totalFeeCredit(address(0));
        uint256 tokenFeesBefore = engine.totalFeeCredit(address(token));
        uint256 tokensBefore = token.balanceOf(address(this));
        uint256 volumeBefore = engine.poolVolumeETH(address(token));
        vm.expectRevert(CarveV4Router.TradeSlippage.selector);
        productionRouter.swapExactInput{value: 0.05 ether}(address(token), true, 0.05 ether, type(uint256).max, 0, block.timestamp);
        vm.expectRevert(CarveV4Router.TradeSlippage.selector);
        productionRouter.swapExactOutput{value: 1}(address(token), true, 1e24, 1, 0, block.timestamp);
        vm.expectRevert(CarveV4Router.InvalidCallback.selector); productionRouter.unlockCallback(abi.encode(address(this)));
        require(engine.totalFeeCredit(address(0)) == nativeFeesBefore && engine.totalFeeCredit(address(token)) == tokenFeesBefore, "slippage failure cannot accrue fees");
        require(token.balanceOf(address(this)) == tokensBefore && productionRouter.totalPendingETH() == 0, "failed order consumes nothing");
        require(engine.poolVolumeETH(address(token)) == volumeBefore, "failed swaps cannot add volume");
        _assertProductionSwap(true, true);
    }

    function testProductionRouterPartialBuyRefundAndExactOutputShortfall() public {
        ICarveMigrationAdapterV2.MigrationReceipt memory r = _graduate();
        CarveMigrationMath.Plan memory p = CarveMigrationMath.plan(r.tokensSpent + r.lockedTokens);
        uint160 limit = uint160(uint256(p.sqrtPriceX96) * 999 / 1000);
        (uint256 input, uint256 output) = productionRouter.swapExactInput{value: 1 ether}(
            address(token), true, 1 ether, 1, limit, block.timestamp);
        require(input < 1 ether && output > 0 && productionRouter.pendingETH(address(this)) == 1 ether - input, "partial exact input refund credited");
        uint256 creditBefore = productionRouter.pendingETH(address(this));
        // A further valid price limit permits some output, but less than the requested exact output.
        uint160 nextLimit = uint160(uint256(limit) * 999 / 1000);
        vm.expectRevert(CarveV4Router.TradeSlippage.selector);
        productionRouter.swapExactOutput{value: 1 ether}(address(token), true, 1e24, 1 ether, nextLimit, block.timestamp);
        require(productionRouter.pendingETH(address(this)) == creditBefore, "unfillable exact output does not alter credit");
    }

    function testAtomicDeploymentCoordinatorWiresRealFactoryEngineAndRouter() public {
        vm.chainId(4663);
        uint64 nonce = vm.getNonce(address(this));
        require(nonce > 0 && nonce < 128, "simple coordinator address prediction");
        address predicted = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), uint8(nonce))))));
        address futureFactory = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", predicted, hex"02")))));
        bytes32 initHash = keccak256(abi.encodePacked(type(CarveV4Engine).creationCode, abi.encode(CANONICAL_PM, futureFactory)));
        bytes32 salt = _mineSaltFor(predicted, initHash);
        uint256 gasBefore = gasleft();
        CarveDeployment coordinator = new CarveDeployment(registry, PLATFORM, salt);
        require(gasBefore - gasleft() < 32_000_000, "coordinator constructor below chain execution cap");
        require(address(coordinator) == predicted && address(coordinator.registry()) == address(registry), "coordinator and registry binding");
        CarveFactoryV2 deployedFactory = coordinator.factory();
        CarveV4Engine deployedEngine = coordinator.engine();
        require(address(deployedFactory) == futureFactory && deployedEngine.factory() == futureFactory, "CREATE2 and nonce2 factory binding");
        require(deployedFactory.platformRecipient() == PLATFORM && deployedFactory.migrationAdapter() == address(deployedEngine), "fixed beneficiary and migration binding");
        require(address(coordinator.router().engine()) == address(deployedEngine)
            && address(coordinator.router().poolManager()) == CANONICAL_PM, "separate production router wiring");
        (, address newMarket) = deployedFactory.launch{value: 5.0005 ether}("Coordinated", "WIRE", imageRoot, 0, 0, 200, 1, block.timestamp);
        require(uint8(CarveMarketV2(payable(newMarket)).phase()) == 2 && deployedEngine.verifyPosition(newMarket), "coordinator deployment launches and graduates atomically");
    }

    function testCoordinatorRejectsWrongChainAndUnverifiedPoolManager() public {
        vm.chainId(1);
        vm.expectRevert(CarveDeployment.WrongChainOrDependency.selector);
        new CarveDeployment(registry, PLATFORM, bytes32(0));
        vm.chainId(4663);
        vm.etch(CANONICAL_PM, hex"00");
        vm.expectRevert(CarveDeployment.WrongChainOrDependency.selector);
        new CarveDeployment(registry, PLATFORM, bytes32(0));
    }

    function testTokenRootsResolveOriginalImageAudioAndHTMLBytes() public {
        bytes memory svg = bytes('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>');
        // A complete PCM WAV: mono, 8-bit, 8000 Hz, two silence samples.
        bytes memory wav = hex"524946462600000057415645666d74201000000001000100401f0000401f00000100080064617461020000008080";
        bytes memory html = bytes('<!doctype html><html lang="en"><meta charset="utf-8"><title>Carve</title><body><h1>Onchain</h1></body></html>');
        bytes32 svgRoot = _registerBytes(svg, "image/svg+xml");
        bytes32 wavRoot = _registerBytes(wav, "audio/wav");
        bytes32 htmlRoot = _registerBytes(html, "text/html");
        (address mediaToken,) = factory.launch{value: 0.0005 ether}("Media roots", "MEDIA", svgRoot, wavRoot, htmlRoot, 0, 0, block.timestamp);
        CarveToken media = CarveToken(mediaToken);
        require(media.contentRegistry() == address(registry) && media.imageRoot() == svgRoot
            && media.audioRoot() == wavRoot && media.websiteRoot() == htmlRoot, "token binds all exact immutable roots");
        require(keccak256(registry.read(media.imageRoot())) == keccak256(svg), "image bytes roundtrip");
        require(keccak256(registry.read(media.audioRoot())) == keccak256(wav), "audio bytes roundtrip");
        require(keccak256(registry.read(media.websiteRoot())) == keccak256(html), "HTML bytes roundtrip");
    }

    function testAudioOnlyAndWebsiteOnlyAutomaticallyGraduateWithPermanentCanonicalPositions() public {
        bytes32 audio = _registerBytes(hex"524946462600000057415645666d74201000000001000100401f0000401f00000100080064617461020000008080", "audio/wav");
        bytes32 website = _registerBytes(bytes("<!doctype html><html><body>Carve</body></html>"), "text/html");
        for (uint8 slot = 0; slot < 2; ++slot) {
            (address t, address m) = factory.launch{value: 5.0005 ether}(
                "Single medium", "SOLO", bytes32(0), slot == 0 ? audio : bytes32(0),
                slot == 1 ? website : bytes32(0), 200, 1, block.timestamp
            );
            CarveToken launched = CarveToken(t);
            require(launched.imageRoot() == 0 && launched.audioRoot() == (slot == 0 ? audio : bytes32(0))
                && launched.websiteRoot() == (slot == 1 ? website : bytes32(0)), "exact optional media roots");
            require(CarveMarketV2(m).phase() == CarveMarketV2.Phase.Graduated && engine.verifyPosition(m),
                "image-free launch auto-graduates into permanent canonical position");
            require(launched.balanceOf(address(this)) > 0 && CarveMarketV2(m).pendingETH(address(this)) > 0,
                "initial tokens and refund survive image-free graduation");
        }
    }

    function _registerBytes(bytes memory data, string memory mime) private returns (bytes32) {
        (address pointer, bytes32 chunkHash) = registry.writeChunk(data);
        address[] memory pointers = new address[](1); pointers[0] = pointer;
        bytes32[] memory hashes = new bytes32[](1); hashes[0] = chunkHash;
        return registry.registerContent(mime, "identity", data.length, pointers, hashes);
    }

    function testForkCanonicalQuoterMatchesAllFourModesWithoutFunding() public {
        address quoter = address(uint160(0x008dc178efb8111bb0973dd9d722ebeff267c98f94));
        vm.skip(quoter.code.length == 0);
        require(quoter.codehash == 0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6, "canonical quoter runtime");
        require(CanonicalV4Quoter(quoter).poolManager() == CANONICAL_PM, "canonical quoter binding");
        _graduate();
        _assertQuoter(quoter, true, true);
        _assertQuoter(quoter, false, true);
        _assertQuoter(quoter, true, false);
        _assertQuoter(quoter, false, false);
    }

    function _assertQuoter(address quoter, bool zeroForOne, bool exactIn) private {
        address unfunded = address(0xFEE123);
        vm.deal(unfunded, 0);
        require(token.balanceOf(unfunded) == 0 && token.allowance(unfunded, quoter) == 0, "unfunded quote caller");
        uint256 nativeFeesBefore = engine.totalFeeCredit(address(0));
        uint256 tokenFeesBefore = engine.totalFeeCredit(address(token));
        uint256 volumeBefore = engine.poolVolumeETH(address(token));
        uint128 amount = exactIn ? uint128(zeroForOne ? 0.05 ether : 1e24) : uint128(zeroForOne ? 1e24 : 0.01 ether);
        CanonicalV4Quoter.QuoteExactSingleParams memory request =
            CanonicalV4Quoter.QuoteExactSingleParams(engine.keyForToken(address(token)), zeroForOne, amount, "");
        uint256 quote;
        uint256 quoteGas;
        vm.prank(unfunded);
        if (exactIn) (quote, quoteGas) = CanonicalV4Quoter(quoter).quoteExactInputSingle(request);
        else (quote, quoteGas) = CanonicalV4Quoter(quoter).quoteExactOutputSingle(request);
        require(quote > 0 && quoteGas > 0, "unfunded canonical quote succeeds");
        require(engine.totalFeeCredit(address(0)) == nativeFeesBefore
            && engine.totalFeeCredit(address(token)) == tokenFeesBefore, "revert quote leaves no fee mutations");
        require(engine.poolVolumeETH(address(token)) == volumeBefore, "canonical quoter revert leaves no volume mutation");
        int256 specified = exactIn ? -int256(uint256(amount)) : int256(uint256(amount));
        BalanceDelta result = swapper.swap{value: zeroForOne ? 1 ether : 0}(request.poolKey,
            SwapParams(zeroForOne, specified, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1));
        int128 actual = exactIn ? (zeroForOne ? result.amount1() : result.amount0())
            : (zeroForOne ? result.amount0() : result.amount1());
        require(quote == uint256(exactIn ? int256(actual) : -int256(actual)), "quote matches actual hook-adjusted execution");
    }
}
