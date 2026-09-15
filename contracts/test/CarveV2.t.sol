// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "../src/CarveContentRegistry.sol";
import {CarveFactoryV2} from "../src/CarveFactoryV2.sol";
import {CarveMarketV2} from "../src/CarveMarketV2.sol";
import {CarveToken} from "../src/CarveToken.sol";
import {CarveEscrow} from "../src/CarveEscrow.sol";
import {CarveFeePolicy} from "../src/CarveFeePolicy.sol";
import {CarveCurveValidation} from "../src/CarveCurveValidation.sol";
import {ICarveMigrationAdapterV2} from "../src/interfaces/ICarveMigrationAdapterV2.sol";

interface V2Vm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert() external;
    function warp(uint256 timestamp) external;
    function getNonce(address account) external view returns (uint64);
    function computeCreateAddress(address deployer, uint256 nonce) external pure returns (address);
}

/// @dev Failure-injection fixture only. This is not evidence of a real v4 position or locked liquidity.
contract MockMigrationEngineV2 is ICarveMigrationAdapterV2 {
    address public immutable override factory;
    address public immutable override poolManager;
    uint128 public constant LIQUIDITY = 1e18;
    uint8 public mode;
    bool public callbackSucceeded;
    bool public snapshotMatched;
    mapping(address => MigrationReceipt) private receipts;
    error MockFailure();
    error UnregisteredMarket();

    constructor(address factory_) { factory = factory_; poolManager = address(this); }
    function setMode(uint8 mode_) external { mode = mode_; }
    function getReceipt(address market) external view returns (MigrationReceipt memory) { return receipts[market]; }
    function verifyPosition(address market) external view returns (bool) {
        return mode != 3 && receipts[market].liquidity != 0;
    }

    function migrate(address token, uint256 inventory, uint128 minLiquidity, uint256 deadline)
        external payable returns (MigrationReceipt memory receipt)
    {
        if (!CarveFactoryV2(factory).isMarket(msg.sender)) revert UnregisteredMarket();
        CarveMarketV2 market = CarveMarketV2(msg.sender);
        snapshotMatched = market.phase() == CarveMarketV2.Phase.Migrating && market.reserveETH() == msg.value
            && market.inventory() == inventory && address(market.token()) == token
            && market.migrationAdapter() == address(this) && market.locker() == address(this);
        require(snapshotMatched, "snapshot mismatch");
        if (mode == 1 || block.timestamp > deadline || minLiquidity > LIQUIDITY) revert MockFailure();
        if (mode == 6) {
            (bool graduateOK,) = msg.sender.call(abi.encodeCall(market.graduate, (0, deadline)));
            (bool buyOK,) = msg.sender.call(abi.encodeCall(market.buy, (0, deadline)));
            (bool sellOK,) = msg.sender.call(abi.encodeCall(market.sell, (0, 0, deadline)));
            (bool withdrawOK,) = msg.sender.call(abi.encodeCall(market.withdrawETH, (payable(address(this)))));
            callbackSucceeded = graduateOK || buyOK || sellOK || withdrawOK;
        }
        if (mode != 4) require(CarveToken(token).transferFrom(msg.sender, address(this), inventory), "token pull");
        receipt = MigrationReceipt({
            poolId: keccak256(abi.encode(msg.sender, token, address(this))),
            liquidity: mode == 7 ? 0 : LIQUIDITY,
            ethSpent: msg.value - 1,
            tokensSpent: inventory * 2 / 3,
            lockedETH: 1,
            lockedTokens: inventory - inventory * 2 / 3
        });
        receipts[msg.sender] = receipt;
        if (mode == 2) receipts[msg.sender].poolId = bytes32(uint256(1));
        if (mode == 5) receipt.lockedETH += 1;
    }
}

contract V2RejectingReceiver {
    CarveMarketV2 public market;
    bool public reenter;
    bool public reentrySucceeded;
    function configure(CarveMarketV2 market_, bool reenter_) external { market = market_; reenter = reenter_; }
    function buy() external payable { market.buy{value: msg.value}(0, type(uint256).max); }
    function sellAll() external {
        CarveToken token = market.token();
        require(token.approve(address(market), type(uint256).max));
        market.sell(token.balanceOf(address(this)), 0, type(uint256).max);
    }
    function withdraw(address payable to) external { market.withdrawETH(to); }
    receive() external payable {
        if (!reenter) revert("recipient rejects ETH");
        (reentrySucceeded,) = address(market).call(abi.encodeCall(market.withdrawETH, (payable(address(this)))));
    }
}

contract CarveV2Test {
    V2Vm private constant vm = V2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant PLATFORM = 0x505f9d726CAc7fDa7129319ca1693Ace4Bb2C048;
    uint256 private constant SUPPLY = 1_000_000_000e18;
    uint256 private constant CREATION_FEE = 0.0005 ether;
    CarveContentRegistry private registry;
    CarveFactoryV2 private factory;
    CarveMarketV2 private market;
    CarveToken private token;
    MockMigrationEngineV2 private engine;
    bytes32 private imageRoot;
    bytes32 private audioRoot;
    bytes32 private websiteRoot;
    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 1_000 ether);
        vm.deal(ALICE, 1_000 ether);
        vm.deal(BOB, 1_000 ether);
        registry = new CarveContentRegistry();
        imageRoot = _register(bytes("<svg></svg>"), "image/svg+xml");
        audioRoot = _register(hex"524946460000000057415645", "audio/wav");
        websiteRoot = _register(bytes("<!doctype html><h1>Carve V2</h1>"), "text/html");
        address predictedFactory = vm.computeCreateAddress(address(this), uint256(vm.getNonce(address(this))) + 1);
        engine = new MockMigrationEngineV2(predictedFactory);
        factory = new CarveFactoryV2(registry, PLATFORM, address(engine));
        require(address(factory) == predictedFactory, "factory nonce binding");
        vm.prank(ALICE);
        (address t, address m) = factory.launch{value: CREATION_FEE}(
            "Carve V2", "CARVE", imageRoot, audioRoot, websiteRoot, 200, 0, block.timestamp
        );
        token = CarveToken(t);
        market = CarveMarketV2(m);
    }

    function _register(bytes memory data, string memory mime) private returns (bytes32 root) {
        (address pointer, bytes32 hash) = registry.writeChunk(data);
        address[] memory pointers = new address[](1); pointers[0] = pointer;
        bytes32[] memory hashes = new bytes32[](1); hashes[0] = hash;
        return registry.registerContent(mime, "identity", data.length, pointers, hashes);
    }
    function _buy(address who, uint256 gross) private returns (uint256) {
        vm.prank(who); return market.buy{value: gross}(0, block.timestamp);
    }
    function _sell(address who, uint256 amount) private returns (uint256 proceeds) {
        vm.startPrank(who);
        require(token.approve(address(market), amount));
        proceeds = market.sell(amount, 0, block.timestamp);
        vm.stopPrank();
    }
    function _solvent() private view {
        require(address(market).balance >= market.reserveETH() + market.totalPendingETH(), "ETH liabilities covered");
        require(token.balanceOf(address(market)) >= market.inventory(), "inventory covered");
        require(market.reserveETH() <= market.capETH() && market.inventory() <= SUPPLY, "bounded curve");
    }
    function _cap() private {
        _buy(BOB, 10 ether);
        require(market.phase() == CarveMarketV2.Phase.Graduated && !market.canGraduate(), "cap automatically migrates");
    }

    function testApprovedEconomicsAndPermanentAttribution() public view {
        require(factory.supply() == SUPPLY && token.totalSupply() == SUPPLY, "approved supply");
        require(factory.virtualETH() == 1.68 ether && market.virtualETH() == 1.68 ether, "approved virtual ETH");
        require(factory.capETH() == 4.2 ether && market.capETH() == 4.2 ether, "approved cap");
        require(factory.creationFee() == CREATION_FEE && factory.creatorFeeLimitBps() == 1_000, "approved launch fee/limit");
        require(factory.platformFeeBps() == 100 && market.platformFeeBps() == 100, "Carve 1%");
        require(market.creatorFeeBps() == 200 && market.creatorFeeLimitBps() == 1_000, "per-token creator fee");
        require(market.creator() == ALICE && token.creator() == ALICE && market.platformRecipient() == PLATFORM, "beneficiaries");
        require(market.factory() == address(factory) && market.migrationAdapter() == address(engine)
            && market.locker() == address(engine), "immutable graph");
        require(token.contentRegistry() == address(registry) && token.imageRoot() == imageRoot
            && token.audioRoot() == audioRoot && token.websiteRoot() == websiteRoot, "content roots");
        require(factory.isMarket(address(market)) && factory.marketForToken(address(token)) == address(market)
            && factory.marketCount() == 1, "authoritative registry");
        require(!factory.isMarket(BOB) && market.phase() == CarveMarketV2.Phase.Curve && !market.canGraduate(), "initial phase");
    }

    function testAtomicCreatorInitialBuyAndSeparateFeeCredits() public {
        vm.prank(BOB);
        (address t, address m) = factory.launch{value: CREATION_FEE + 1 ether}(
            "Initial", "INIT", imageRoot, audioRoot, websiteRoot, 1_000, 1, block.timestamp
        );
        CarveMarketV2 launched = CarveMarketV2(m);
        require(CarveToken(t).creator() == BOB && CarveToken(t).balanceOf(BOB) > 0, "creator initial purchase");
        require(launched.reserveETH() == 0.89 ether, "net reserve");
        require(launched.pendingETH(PLATFORM) == 0.01 ether && launched.pendingETH(BOB) == 0.1 ether, "separate fees");
        require(factory.pendingETH(PLATFORM) == 2 * CREATION_FEE, "creation fee all Carve");
        require(factory.isMarket(m), "registered after constructor");
    }

    function testEveryNonemptyMediaCombinationPreservesExactRootsAndInitialBuy() public {
        for (uint8 mask = 1; mask < 8; ++mask) {
            bytes32 image = (mask & 1) != 0 ? imageRoot : bytes32(0);
            bytes32 audio = (mask & 2) != 0 ? audioRoot : bytes32(0);
            bytes32 website = (mask & 4) != 0 ? websiteRoot : bytes32(0);
            vm.prank(BOB);
            (address t, address m) = factory.launch{value: CREATION_FEE + 0.01 ether}(
                "Any media", "MEDIA", image, audio, website, 200, 1, block.timestamp
            );
            CarveToken created = CarveToken(t);
            require(created.imageRoot() == image && created.audioRoot() == audio
                && created.websiteRoot() == website, "exact selected and absent roots");
            require(created.contentRegistry() == address(registry) && created.creator() == BOB
                && created.balanceOf(BOB) > 0 && factory.marketForToken(t) == m, "attribution and initial buy");
            require(CarveMarketV2(m).reserveETH() == 0.0097 ether && CarveMarketV2(m).curveVolumeETH() == 0.0097 ether,
                "unchanged net reserve economics and initial native volume");
            if (image != 0) require(registry.read(image).length > 0, "stored image bytes");
            if (audio != 0) require(registry.read(audio).length > 0, "stored audio bytes");
            if (website != 0) require(registry.read(website).length > 0, "stored website bytes");
        }
        require(factory.marketCount() == 8 && factory.pendingETH(PLATFORM) == 8 * CREATION_FEE,
            "all seven combinations launch and charge exactly once");
    }

    function testEmptyAndUnknownMediaSelectionsRevertBeforeCharging() public {
        uint256 balanceBefore = address(this).balance;
        uint64 nonceBefore = vm.getNonce(address(factory));
        vm.expectRevert(CarveFactoryV2.InvalidContent.selector);
        factory.launch{value: CREATION_FEE}("Empty", "NONE", 0, 0, 0, 0, 0, block.timestamp);
        for (uint8 mask = 1; mask < 8; ++mask) {
            for (uint8 slot = 1; slot <= 4; slot <<= 1) {
                if ((mask & slot) == 0) continue;
                bytes32 image = (mask & 1) != 0 ? imageRoot : bytes32(0);
                bytes32 audio = (mask & 2) != 0 ? audioRoot : bytes32(0);
                bytes32 website = (mask & 4) != 0 ? websiteRoot : bytes32(0);
                if (slot == 1) image = bytes32(uint256(1));
                if (slot == 2) audio = bytes32(uint256(1));
                if (slot == 4) website = bytes32(uint256(1));
                vm.expectRevert(CarveFactoryV2.InvalidContent.selector);
                factory.launch{value: CREATION_FEE + 1 ether}("Unknown", "BAD", image, audio, website, 200, 0, block.timestamp);
            }
        }
        require(factory.marketCount() == 1 && factory.pendingETH(PLATFORM) == CREATION_FEE
            && factory.totalPendingETH() == CREATION_FEE, "invalid selections never charge or register");
        require(address(this).balance == balanceBefore && vm.getNonce(address(factory)) == nonceBefore,
            "invalid selections preserve value and deployment nonce");
    }

    function testCapFilledInitialBuyRegistersThenAutomaticallyGraduates() public {
        CarveFeePolicy.CappedBuy memory quote = CarveFeePolicy.cappedBuy(10 ether, 4.2 ether, 1_000, 1_000);
        uint256 expectedTokens = SUPPLY * quote.net / (1.68 ether + quote.net);
        engine.setMode(6);
        vm.prank(BOB);
        (address t, address m) = factory.launch{value: CREATION_FEE + 10 ether}(
            "Initial Cap", "ICAP", imageRoot, audioRoot, websiteRoot, 1_000, expectedTokens, block.timestamp
        );
        CarveMarketV2 launched = CarveMarketV2(m);
        ICarveMigrationAdapterV2.MigrationReceipt memory receipt = launched.graduationReceipt();
        require(factory.marketCount() == 2 && factory.markets(1) == m && factory.isMarket(m)
            && factory.marketForToken(t) == m, "initial cap registered before authenticated migration");
        require(launched.phase() == CarveMarketV2.Phase.Graduated && !launched.canGraduate()
            && !launched.capReached(), "initial launch returns already graduated");
        require(launched.reserveETH() == 0 && launched.inventory() == 0, "initial principal migrated");
        require(CarveToken(t).balanceOf(BOB) == expectedTokens
            && CarveToken(t).balanceOf(address(engine)) == SUPPLY - expectedTokens, "initial token conservation");
        require(receipt.ethSpent + receipt.lockedETH == 4.2 ether
            && receipt.tokensSpent + receipt.lockedTokens == SUPPLY - expectedTokens, "initial principal receipt");
        require(receipt.liquidity == engine.LIQUIDITY() && receipt.poolId == engine.getReceipt(m).poolId
            && engine.snapshotMatched() && !engine.callbackSucceeded(), "authenticated snapshot and guarded migration");
        require(launched.pendingETH(PLATFORM) == quote.platformFee
            && launched.pendingETH(BOB) == quote.creatorFee + quote.refund, "creator fee and initial refund retained");
        require(address(launched).balance == launched.totalPendingETH()
            && address(engine).balance == 4.2 ether, "initial ETH principal and escrow separate");
        require(CarveToken(t).allowance(m, address(engine)) == 0, "initial migration approval cleared");
        require(factory.pendingETH(PLATFORM) == 2 * CREATION_FEE, "creation fee remains separate");
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); launched.graduate(0, block.timestamp);
    }

    function testRevertedInitialBuyRollsBackLaunchAndCreationFee() public {
        uint256 balanceBefore = BOB.balance;
        uint256 nonceBefore = vm.getNonce(address(factory));
        vm.prank(BOB); vm.expectRevert(CarveMarketV2.Slippage.selector);
        factory.launch{value: CREATION_FEE + 1 ether}("Bad", "BAD", imageRoot, 0, 0, 200, SUPPLY, block.timestamp);
        require(factory.marketCount() == 1 && factory.pendingETH(PLATFORM) == CREATION_FEE, "launch rollback");
        require(BOB.balance == balanceBefore && vm.getNonce(address(factory)) == nonceBefore, "value and CREATE rollback");
    }

    function testInitialCapMigrationFailuresRollbackDeploymentRegistryAndAllFees() public {
        uint256 balanceBefore = BOB.balance;
        uint256 nonceBefore = vm.getNonce(address(factory));
        address predictedMarket = vm.computeCreateAddress(address(factory), nonceBefore);
        address predictedToken = vm.computeCreateAddress(predictedMarket, 1);
        for (uint8 mode = 1; mode <= 7; ++mode) {
            if (mode == 6) continue;
            engine.setMode(mode);
            vm.prank(BOB); vm.expectRevert();
            factory.launch{value: CREATION_FEE + 10 ether}(
                "Atomic Cap", "ACAP", imageRoot, 0, 0, 200, 0, block.timestamp
            );
            require(factory.marketCount() == 1 && factory.markets(0) == address(market)
                && !factory.isMarket(predictedMarket) && factory.marketForToken(predictedToken) == address(0),
                "failed automatic initial migration rolls back registry");
            require(factory.pendingETH(PLATFORM) == CREATION_FEE && factory.totalPendingETH() == CREATION_FEE
                && address(factory).balance == CREATION_FEE, "failed initial migration rolls back creation fee");
            require(BOB.balance == balanceBefore && vm.getNonce(address(factory)) == nonceBefore,
                "failed initial migration refunds value and CREATE nonce");
            require(predictedMarket.code.length == 0 && predictedToken.code.length == 0
                && predictedMarket.balance == 0, "failed initial migration removes new market and token");
            require(address(engine).balance == 0 && engine.getReceipt(predictedMarket).poolId == 0
                && !engine.snapshotMatched(), "failed initial migration rolls back engine");
            require(market.phase() == CarveMarketV2.Phase.Curve && market.reserveETH() == 0
                && market.inventory() == SUPPLY, "existing launch unchanged");
        }
        engine.setMode(0);
        vm.prank(BOB);
        (address t, address m) = factory.launch{value: CREATION_FEE + 10 ether}(
            "Atomic Cap", "ACAP", imageRoot, 0, 0, 200, 0, block.timestamp
        );
        require(m == predictedMarket && t == predictedToken && factory.isMarket(m)
            && CarveMarketV2(m).phase() == CarveMarketV2.Phase.Graduated, "initial cap retry succeeds at same addresses");
    }

    function testPerTokenCreatorFeeChoiceDoesNotChangeCarveRate() public {
        (, address zeroMarket) = factory.launch{value: CREATION_FEE + 1 ether}("Zero", "ZERO", imageRoot, 0, 0, 0, 0, block.timestamp);
        (, address maxMarket) = factory.launch{value: CREATION_FEE + 1 ether}("Max", "MAX", imageRoot, 0, 0, 1_000, 0, block.timestamp);
        require(CarveMarketV2(zeroMarket).pendingETH(PLATFORM) == 0.01 ether
            && CarveMarketV2(maxMarket).pendingETH(PLATFORM) == 0.01 ether, "same Carve rate");
        require(CarveMarketV2(zeroMarket).pendingETH(address(this)) == 0
            && CarveMarketV2(maxMarket).pendingETH(address(this)) == 0.1 ether, "independent creator entitlement");
        require(CarveMarketV2(zeroMarket).creatorFeeBps() == 0 && CarveMarketV2(maxMarket).creatorFeeBps() == 1_000, "per launch rate");
    }

    function testLaunchRejectsFeeBoundsBeforeCharging() public {
        vm.expectRevert(CarveFeePolicy.CreatorFeeAboveLimit.selector);
        factory.launch{value: CREATION_FEE}("Bad", "BAD", imageRoot, 0, 0, 1_001, 0, block.timestamp);
        require(factory.marketCount() == 1 && factory.pendingETH(PLATFORM) == CREATION_FEE, "no invalid launch fee");
    }

    function testLaunchRejectsInvalidNamesContentPaymentAndDeadline() public {
        vm.expectRevert(CarveFactoryV2.InvalidLaunch.selector);
        factory.launch{value: CREATION_FEE}("", "A", imageRoot, 0, 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveFactoryV2.InvalidLaunch.selector);
        factory.launch{value: CREATION_FEE}(string(new bytes(65)), "A", imageRoot, 0, 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveFactoryV2.InvalidLaunch.selector);
        factory.launch{value: CREATION_FEE}("A", string(new bytes(13)), imageRoot, 0, 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveFactoryV2.InvalidContent.selector);
        factory.launch{value: CREATION_FEE}("A", "A", 0, 0, 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveFactoryV2.InvalidContent.selector);
        factory.launch{value: CREATION_FEE}("A", "A", imageRoot, bytes32(uint256(1)), 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveFactoryV2.InvalidContent.selector);
        factory.launch{value: CREATION_FEE}("A", "A", imageRoot, 0, bytes32(uint256(1)), 0, 0, block.timestamp);
        vm.expectRevert(CarveFactoryV2.InsufficientCreationFee.selector);
        factory.launch("A", "A", imageRoot, 0, 0, 0, 0, block.timestamp);
        vm.warp(1_000);
        vm.expectRevert(CarveMarketV2.DeadlineExpired.selector);
        factory.launch{value: CREATION_FEE}("A", "A", imageRoot, 0, 0, 0, 0, 999);
    }

    function testFactoryRejectsMissingOrWrongEngineBinding() public {
        vm.expectRevert(CarveFactoryV2.InvalidDependencies.selector);
        new CarveFactoryV2(registry, address(0), address(engine));
        vm.expectRevert(CarveFactoryV2.InvalidDependencies.selector);
        new CarveFactoryV2(CarveContentRegistry(BOB), PLATFORM, address(engine));
        vm.expectRevert(CarveFactoryV2.InvalidDependencies.selector);
        new CarveFactoryV2(registry, PLATFORM, BOB);
        vm.expectRevert(CarveFactoryV2.InvalidDependencies.selector);
        new CarveFactoryV2(registry, PLATFORM, address(engine)); // bound to the first factory
    }

    function testMarketRejectsZeroOutputConfigBeforeCreatingToken() public {
        CarveMarketV2.Config memory config = CarveMarketV2.Config(1e18, 1e30, 1, 1_000, PLATFORM, address(engine), address(engine));
        vm.expectRevert(CarveCurveValidation.ZeroInitialBuyCapacity.selector);
        new CarveMarketV2(ALICE, address(registry), "Bad", "BAD", imageRoot, 0, 0, 0, config, 0, block.timestamp);
    }

    function testBuyQuoteAndSeparateCredits() public {
        (uint256 expected, uint256 accepted, uint256 platformFee, uint256 creatorFee, uint256 refund) = market.quoteBuy(1 ether);
        require(accepted == 1 ether && platformFee == 0.01 ether && creatorFee == 0.02 ether && refund == 0, "quote fees");
        require(_buy(BOB, 1 ether) == expected && market.reserveETH() == 0.97 ether, "buy quote execution");
        require(market.pendingETH(PLATFORM) == platformFee && market.pendingETH(ALICE) == creatorFee, "exact credits");
        _solvent();
    }

    function testCurveVolumeCountsOnlyExecutedNativeReserveLegs() public {
        require(market.curveVolumeETH() == 0, "no initial purchase means zero volume");
        uint256 tokensBought = _buy(BOB, 1 ether);
        require(market.curveVolumeETH() == 0.97 ether, "net curve buy excludes external fees");
        (uint256 net, uint256 platformFee, uint256 creatorFee) = market.quoteSell(tokensBought / 3);
        market.quoteBuy(0.1 ether);
        require(market.curveVolumeETH() == 0.97 ether, "view quotes do not count");
        _sell(BOB, tokensBought / 3);
        uint256 total = 0.97 ether + net + platformFee + creatorFee;
        require(market.curveVolumeETH() == total, "sale counts native reserve debit before external fees");
        vm.deal(address(market), address(market).balance + 1 ether);
        vm.prank(BOB); market.withdrawETH(payable(BOB));
        require(market.curveVolumeETH() == total, "donations and withdrawals do not count");
        vm.expectRevert(CarveMarketV2.Slippage.selector); market.buy{value: 0.1 ether}(SUPPLY, block.timestamp);
        vm.prank(BOB); vm.expectRevert(); market.sell(1e18, 1, block.timestamp);
        require(market.curveVolumeETH() == total, "failed buy and post-accounting token-transfer failure roll back volume");
        uint256 remaining = market.capETH() - market.reserveETH();
        _cap();
        require(market.curveVolumeETH() == total + remaining, "cap counts only accepted native leg; migration is not volume");
    }

    function testSellQuoteCreditsAndWithdrawal() public {
        uint256 amount = _buy(BOB, 1 ether);
        uint256 reserveBefore = market.reserveETH();
        (uint256 proceeds, uint256 platformFee, uint256 creatorFee) = market.quoteSell(amount);
        require(_sell(BOB, amount) == proceeds, "sale quote execution");
        require(market.reserveETH() == reserveBefore - proceeds - platformFee - creatorFee, "sale gross reserve debit");
        require(market.pendingETH(PLATFORM) == 0.01 ether + platformFee
            && market.pendingETH(ALICE) == 0.02 ether + creatorFee, "sale fees separated");
        require(market.pendingETH(BOB) == proceeds && proceeds < 1 ether, "seller credit");
        uint256 balanceBefore = BOB.balance;
        vm.prank(BOB); market.withdrawETH(payable(BOB));
        require(BOB.balance == balanceBefore + proceeds && market.pendingETH(BOB) == 0, "sale withdrawn");
        _solvent();
    }

    function testSlippageDeadlinesAllowanceAndZeroTrades() public {
        vm.expectRevert(CarveMarketV2.Slippage.selector); market.buy{value: 1 ether}(SUPPLY, block.timestamp);
        vm.expectRevert(CarveMarketV2.ZeroTrade.selector); market.buy{value: 1}(0, block.timestamp);
        uint256 amount = _buy(BOB, 1 ether);
        vm.startPrank(BOB);
        vm.expectRevert(CarveToken.InsufficientAllowance.selector); market.sell(amount, 0, block.timestamp);
        require(token.approve(address(market), amount));
        vm.expectRevert(CarveMarketV2.Slippage.selector); market.sell(amount, 1 ether, block.timestamp);
        vm.expectRevert(CarveMarketV2.InvalidAmount.selector); market.sell(amount + 1, 0, block.timestamp);
        vm.expectRevert(CarveMarketV2.ZeroTrade.selector); market.sell(0, 0, block.timestamp);
        vm.stopPrank();
        vm.warp(1_000);
        vm.expectRevert(CarveMarketV2.DeadlineExpired.selector); market.buy{value: 1 ether}(0, 999);
        vm.expectRevert(CarveMarketV2.DeadlineExpired.selector); market.sell(1, 0, 999);
        _solvent();
    }

    function testCapCrossingAutomaticallyGraduatesAndFeesExcludeRefund() public {
        (uint256 expected, uint256 accepted, uint256 platformFee, uint256 creatorFee, uint256 refund) = market.quoteBuy(10 ether);
        uint256 purchased = _buy(BOB, 10 ether);
        require(purchased == expected && market.reserveETH() == 0 && !market.canGraduate(), "exact cap automatically migrated");
        require(accepted - platformFee - creatorFee == 4.2 ether && accepted + refund == 10 ether, "cap fee conservation");
        require(market.pendingETH(BOB) == refund && market.pendingETH(PLATFORM) == platformFee
            && market.pendingETH(ALICE) == creatorFee, "refund and separate fees");
        require(market.phase() == CarveMarketV2.Phase.Graduated
            && engine.getReceipt(address(market)).liquidity != 0, "crossing buy includes migration");
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.buy{value: 1 ether}(0, block.timestamp);
        vm.prank(BOB); require(token.approve(address(market), purchased / 2));
        vm.prank(BOB); vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.sell(purchased / 2, 0, block.timestamp);
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.graduate(0, block.timestamp);
        _solvent();
    }

    function testDonationDoesNotAffectQuotesOrEligibility() public {
        uint256 amount = _buy(BOB, 1 ether);
        (uint256 beforeQuote,,,,) = market.quoteBuy(1 ether);
        vm.prank(BOB); require(token.transfer(address(market), amount / 2));
        vm.deal(address(market), address(market).balance + 100 ether);
        (uint256 afterQuote,,,,) = market.quoteBuy(1 ether);
        require(beforeQuote == afterQuote && !market.canGraduate(), "donations not curve principal");
        _solvent();
    }

    function testFeeWithdrawalCannotConsumeReserveOrOthersCredit() public {
        _buy(BOB, 1 ether);
        vm.prank(BOB); vm.expectRevert(CarveEscrow.NoCredit.selector); market.withdrawETH(payable(BOB));
        vm.prank(PLATFORM); market.withdrawETH(payable(PLATFORM));
        vm.prank(ALICE); market.withdrawETH(payable(ALICE));
        require(address(market).balance == market.reserveETH() && market.reserveETH() == 0.97 ether, "reserve remains");
        vm.prank(PLATFORM); factory.withdrawETH(payable(PLATFORM));
        require(address(factory).balance == 0, "factory only creation credit");
    }

    function testRejectingRecipientCanRedirectAndCannotReenterWithdrawal() public {
        V2RejectingReceiver receiver = new V2RejectingReceiver();
        receiver.configure(market, false); receiver.buy{value: 1 ether}(); receiver.sellAll();
        uint256 credit = market.pendingETH(address(receiver));
        vm.expectRevert(CarveEscrow.ETHTransferFailed.selector); receiver.withdraw(payable(address(receiver)));
        require(market.pendingETH(address(receiver)) == credit, "failed withdrawal retains credit");
        receiver.configure(market, true); receiver.withdraw(payable(address(receiver)));
        require(!receiver.reentrySucceeded() && address(receiver).balance == credit, "no duplicated withdrawal");
        receiver.configure(market, false); receiver.buy{value: 1 ether}(); receiver.sellAll();
        credit = market.pendingETH(address(receiver));
        uint256 balanceBefore = BOB.balance;
        receiver.withdraw(payable(BOB));
        require(BOB.balance == balanceBefore + credit, "rejecting account redirects own credit");
        _solvent();
    }

    function testGraduationReceiptPhasePrincipalAndCredits() public {
        uint256 firstPurchase = _buy(BOB, 1 ether);
        _sell(BOB, firstPurchase / 4);
        uint256 oldSellerCredit = market.pendingETH(BOB);
        (uint256 bought,, uint256 platformFee, uint256 creatorFee, uint256 refund) = market.quoteBuy(10 ether);
        uint256 inventoryBefore = market.inventory() - bought;
        uint256 creditsBefore = market.totalPendingETH() + platformFee + creatorFee + refund;
        _cap();
        ICarveMigrationAdapterV2.MigrationReceipt memory receipt = market.graduationReceipt();
        require(market.phase() == CarveMarketV2.Phase.Graduated && !market.canGraduate(), "final phase");
        require(market.reserveETH() == 0 && market.inventory() == 0, "accounted principal migrated");
        require(receipt.ethSpent + receipt.lockedETH == 4.2 ether
            && receipt.tokensSpent + receipt.lockedTokens == inventoryBefore, "principal receipt");
        require(keccak256(abi.encode(receipt)) == keccak256(abi.encode(engine.getReceipt(address(market))))
            && engine.snapshotMatched(), "stored receipt/snapshot");
        require(token.balanceOf(address(engine)) == inventoryBefore && address(engine).balance == 4.2 ether, "mock principal movement");
        require(address(market).balance == creditsBefore && market.totalPendingETH() == creditsBefore, "old credits remain covered");
        require(market.pendingETH(BOB) == oldSellerCredit + refund, "old sale proceeds survive crossing buy migration");
        require(token.allowance(address(market), address(engine)) == 0, "approval cleared");
        vm.prank(BOB); market.withdrawETH(payable(BOB));
        vm.prank(ALICE); market.withdrawETH(payable(ALICE));
        vm.prank(PLATFORM); market.withdrawETH(payable(PLATFORM));
        require(address(market).balance == 0 && market.totalPendingETH() == 0, "all credits withdraw after graduation");
    }

    function testGraduationPreservesUnsolicitedBalances() public {
        _buy(BOB, 1 ether);
        vm.prank(BOB); require(token.transfer(address(market), 123));
        vm.deal(address(market), address(market).balance + 1 ether);
        _cap();
        require(token.balanceOf(address(market)) == 123, "donated tokens not migrated");
        require(address(market).balance == market.totalPendingETH() + 1 ether, "donated ETH not migrated");
    }

    function testAutomaticGraduationRequiresValidCrossingBuyDeadlineAndSlippage() public {
        vm.expectRevert(CarveMarketV2.GraduationNotReady.selector); market.graduate(0, block.timestamp);
        vm.warp(1_000);
        vm.expectRevert(CarveMarketV2.DeadlineExpired.selector); market.graduate(0, 999);
        vm.expectRevert(CarveMarketV2.GraduationNotReady.selector); market.graduate(type(uint128).max, 1_000);
        uint256 buyerBalance = BOB.balance;
        vm.prank(BOB); vm.expectRevert(CarveMarketV2.DeadlineExpired.selector); market.buy{value: 10 ether}(0, 999);
        (uint256 expected,,,,) = market.quoteBuy(10 ether);
        vm.prank(BOB); vm.expectRevert(CarveMarketV2.Slippage.selector); market.buy{value: 10 ether}(expected + 1, 1_000);
        require(BOB.balance == buyerBalance && token.balanceOf(BOB) == 0, "invalid crossing orders do not charge buyer");
        require(market.phase() == CarveMarketV2.Phase.Curve && market.reserveETH() == 0 && market.inventory() == SUPPLY
            && market.totalPendingETH() == 0 && address(market).balance == 0, "invalid crossing orders leave curve untouched");
        require(engine.getReceipt(address(market)).liquidity == 0 && address(engine).balance == 0, "invalid orders never migrate");
        vm.prank(BOB); require(market.buy{value: 10 ether}(expected, 1_000) == expected, "deadline-inclusive crossing succeeds");
        require(market.phase() == CarveMarketV2.Phase.Graduated, "valid retry automatically graduates");
        _solvent();
    }

    function testMigrationFailuresRollbackAllStateAndAllowRetry() public {
        uint256 firstPurchase = _buy(BOB, 1 ether);
        _sell(BOB, firstPurchase / 4);
        uint256 ethBefore = address(market).balance;
        uint256 reserveBefore = market.reserveETH();
        uint256 inventoryBefore = market.inventory();
        uint256 creditsBefore = market.totalPendingETH();
        uint256 platformBefore = market.pendingETH(PLATFORM);
        uint256 creatorBefore = market.pendingETH(ALICE);
        uint256 buyerCreditBefore = market.pendingETH(BOB);
        uint256 buyerETHBefore = BOB.balance;
        uint256 buyerTokensBefore = token.balanceOf(BOB);
        (uint256 quoteBefore,,,,) = market.quoteBuy(10 ether);
        for (uint8 mode = 1; mode <= 7; ++mode) {
            if (mode == 6) continue;
            engine.setMode(mode);
            vm.prank(BOB); vm.expectRevert(); market.buy{value: 10 ether}(quoteBefore, block.timestamp);
            require(market.phase() == CarveMarketV2.Phase.Curve && !market.canGraduate(), "crossing purchase phase rolls back");
            require(market.reserveETH() == reserveBefore && market.inventory() == inventoryBefore
                && market.totalPendingETH() == creditsBefore, "accounting rolls back");
            require(market.pendingETH(PLATFORM) == platformBefore && market.pendingETH(ALICE) == creatorBefore
                && market.pendingETH(BOB) == buyerCreditBefore, "crossing fees and refund roll back individually");
            require(BOB.balance == buyerETHBefore && token.balanceOf(BOB) == buyerTokensBefore, "entire crossing buy rolls back");
            require(address(market).balance == ethBefore && token.balanceOf(address(market)) == inventoryBefore, "balances roll back");
            require(address(engine).balance == 0 && token.balanceOf(address(engine)) == 0
                && engine.getReceipt(address(market)).poolId == 0, "engine changes roll back");
            require(market.graduationReceipt().poolId == 0 && !engine.snapshotMatched(), "migration snapshot and receipt roll back");
            require(token.allowance(address(market), address(engine)) == 0, "allowance rolls back");
            (uint256 quoteAfter,,,,) = market.quoteBuy(10 ether);
            require(quoteAfter == quoteBefore, "retry quote is unchanged");
            _solvent();
        }
        engine.setMode(0); _cap();
        require(market.phase() == CarveMarketV2.Phase.Graduated, "retry succeeds");
    }

    function testMigrationReentrancyAndPostGraduationCurveCallsRejected() public {
        engine.setMode(6); _cap();
        require(!engine.callbackSucceeded(), "migration callbacks cannot trade/withdraw/reenter");
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.graduate(0, block.timestamp);
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.buy{value: 1 ether}(0, block.timestamp);
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.sell(1, 0, block.timestamp);
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.quoteBuy(1 ether);
        vm.expectRevert(CarveMarketV2.WrongPhase.selector); market.quoteSell(1);
    }

    function testCrossingBuyWinsRaceAndStaleSecondBuyCannotChargeOrRemigrate() public {
        (uint256 staleQuote,,,,) = market.quoteBuy(10 ether);
        vm.prank(ALICE); require(market.buy{value: 10 ether}(staleQuote, block.timestamp) == staleQuote, "first crossing buy wins");
        bytes32 receiptBefore = keccak256(abi.encode(market.graduationReceipt()));
        uint256 creditsBefore = market.totalPendingETH();
        uint256 ethBefore = address(market).balance;
        uint256 buyerBefore = BOB.balance;
        vm.prank(BOB); vm.expectRevert(CarveMarketV2.WrongPhase.selector);
        market.buy{value: 10 ether}(staleQuote, block.timestamp);
        require(BOB.balance == buyerBefore && token.balanceOf(BOB) == 0 && market.pendingETH(BOB) == 0,
            "stale second buyer neither charged nor credited");
        require(keccak256(abi.encode(market.graduationReceipt())) == receiptBefore
            && market.totalPendingETH() == creditsBefore && address(market).balance == ethBefore,
            "stale crossing cannot modify completed migration");
        require(address(engine).balance == 4.2 ether && token.balanceOf(address(engine)) == SUPPLY - staleQuote,
            "only one principal migration");
    }

    function testEngineRequiresAuthoritativeRegistry() public {
        vm.expectRevert(MockMigrationEngineV2.UnregisteredMarket.selector);
        engine.migrate{value: 1 ether}(address(token), 1, 0, block.timestamp);
    }

    function testNoMutableEconomicsPrincipalSweepOrMint() public {
        (bool changed,) = address(market).call(abi.encodeWithSignature("setCreatorFee(uint16)", 1));
        (bool seized,) = address(market).call(abi.encodeWithSignature("withdrawReserves(address)", BOB));
        (bool registered,) = address(factory).call(abi.encodeWithSignature("registerMarket(address)", BOB));
        (bool minted,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", BOB, 1));
        require(!changed && !seized && !registered && !minted, "no administrative mutation");
    }

    function testFuzzCreatorFeesStaySeparateThroughBuyAndSell(uint16 rateSeed, uint96 grossSeed) public {
        uint16 rate = rateSeed % 1_001;
        uint256 gross = uint256(grossSeed) % (3 ether) + 10_000;
        vm.prank(ALICE);
        (address t, address m) = factory.launch{value: CREATION_FEE}("Fuzz", "FUZ", imageRoot, 0, 0, rate, 0, block.timestamp);
        CarveMarketV2 target = CarveMarketV2(m);
        CarveToken asset = CarveToken(t);
        CarveFeePolicy.Amounts memory buyAmounts = CarveFeePolicy.fromGross(gross, rate, 1_000);
        vm.startPrank(BOB);
        uint256 bought = target.buy{value: gross}(0, block.timestamp);
        require(asset.approve(m, bought));
        (uint256 ethOut, uint256 platformSell, uint256 creatorSell) = target.quoteSell(bought);
        target.sell(bought, ethOut, block.timestamp);
        vm.stopPrank();
        require(target.pendingETH(PLATFORM) == buyAmounts.platformFee + platformSell, "platform never shared");
        require(target.pendingETH(ALICE) == buyAmounts.creatorFee + creatorSell, "all additional creator fee");
        require(target.pendingETH(BOB) == ethOut && ethOut <= gross, "round trip cannot profit");
        require(address(target).balance == target.reserveETH() + target.totalPendingETH(), "fee/curve solvency");
        require(target.inventory() == SUPPLY && asset.balanceOf(m) == SUPPLY, "token conservation");
    }

    function testFuzzMixedTradingAndCapAccounting(uint256 seed) public {
        for (uint256 i; i < 20 && market.phase() == CarveMarketV2.Phase.Curve; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address trader = seed & 1 == 0 ? ALICE : BOB;
            uint256 balance = token.balanceOf(trader);
            uint256 beforeK = market.inventory() * (market.virtualETH() + market.reserveETH());
            if (balance > 1e12 && (seed >> 1) & 1 == 1) _sell(trader, balance / 2);
            else _buy(trader, seed % (2 ether) + 10_000);
            if (market.phase() == CarveMarketV2.Phase.Graduated) {
                ICarveMigrationAdapterV2.MigrationReceipt memory receipt = market.graduationReceipt();
                require((receipt.tokensSpent + receipt.lockedTokens) * (market.virtualETH() + market.capETH()) >= beforeK,
                    "product cannot fall at automatic migration snapshot");
            } else {
                require(market.inventory() * (market.virtualETH() + market.reserveETH()) >= beforeK, "product cannot fall");
            }
            _solvent();
        }
        uint256 beforeFinalK = market.inventory() * (market.virtualETH() + market.reserveETH());
        if (market.phase() == CarveMarketV2.Phase.Curve) _cap();
        ICarveMigrationAdapterV2.MigrationReceipt memory finalReceipt = market.graduationReceipt();
        require(market.phase() == CarveMarketV2.Phase.Graduated && market.reserveETH() == 0 && market.inventory() == 0,
            "mixed path automatically graduates");
        require(finalReceipt.ethSpent + finalReceipt.lockedETH == 4.2 ether, "migration reserve cap precise");
        require((finalReceipt.tokensSpent + finalReceipt.lockedTokens) * (market.virtualETH() + market.capETH()) >= beforeFinalK,
            "final cap purchase preserves product");
        require(token.balanceOf(ALICE) + token.balanceOf(BOB) + token.balanceOf(address(engine)) == SUPPLY
            && token.balanceOf(address(market)) == 0, "mixed-path token conservation after migration");
        require(token.allowance(address(market), address(engine)) == 0 && engine.snapshotMatched(), "mixed-path migration verified");
        require(address(market).balance == market.totalPendingETH(), "credits covered after mixed-path migration");
    }
}
