// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "../src/CarveContentRegistry.sol";
import {CarveFactory} from "../src/CarveFactory.sol";
import {CarveMarket} from "../src/CarveMarket.sol";
import {CarveToken} from "../src/CarveToken.sol";
import {CarveEscrow} from "../src/CarveEscrow.sol";

interface Vm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert() external;
    function warp(uint256 timestamp) external;
}

contract RejectingAndReenteringReceiver {
    CarveMarket public market;
    bool public reject;
    bool public reenter;
    bool public reentrySucceeded;
    function configure(CarveMarket market_, bool reject_, bool reenter_) external {
        market = market_; reject = reject_; reenter = reenter_;
    }
    function buy() external payable { market.buy{value: msg.value}(0, type(uint256).max); }
    function sellAll() external {
        CarveToken t = market.token();
        t.approve(address(market), type(uint256).max);
        market.sell(t.balanceOf(address(this)), 0, type(uint256).max);
    }
    function withdraw(address payable recipient) external { market.withdrawETH(recipient); }
    receive() external payable {
        if (reject) revert("reject");
        if (reenter) (reentrySucceeded,) = address(market).call(abi.encodeCall(market.withdrawETH, (payable(address(this)))));
    }
}

contract CarveTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant TREASURY = address(0xFEE);
    uint256 private constant SUPPLY = 1_000_000_000e18;
    uint256 private constant CREATION_FEE = 0.01 ether;
    CarveContentRegistry private registry;
    CarveFactory private factory;
    CarveMarket private market;
    CarveToken private token;
    bytes32 private imageRoot;
    bytes32 private audioRoot;
    bytes32 private websiteRoot;
    receive() external payable {}

    function setUp() public {
        vm.deal(address(this), 1_000_000 ether);
        vm.deal(ALICE, 1_000 ether);
        vm.deal(BOB, 1_000 ether);
        registry = new CarveContentRegistry();
        imageRoot = _register(bytes("<svg></svg>"), "image/svg+xml");
        audioRoot = _register(hex"524946460000000057415645", "audio/wav");
        websiteRoot = _register(bytes("<!doctype html><h1>Carve</h1>"), "text/html");
        factory = new CarveFactory(registry, CREATION_FEE, _config());
        vm.prank(ALICE);
        (address t, address m) = factory.launch{value: CREATION_FEE}("Carve Test", "CARVE", imageRoot, audioRoot, websiteRoot, 0, block.timestamp);
        market = CarveMarket(m); token = CarveToken(t);
    }

    function _config() private pure returns (CarveMarket.Config memory) {
        return CarveMarket.Config(SUPPLY, 10 ether, 20 ether, 100, 2_000, TREASURY);
    }
    function _assert(bool condition) private pure { require(condition, "assertion failed"); }
    function _eq(uint256 a, uint256 b) private pure { require(a == b, "uint mismatch"); }
    function _eq(bytes32 a, bytes32 b) private pure { require(a == b, "hash mismatch"); }
    function _eq(address a, address b) private pure { require(a == b, "address mismatch"); }
    function _register(bytes memory data, string memory mime) private returns (bytes32) {
        (address pointer, bytes32 hash) = registry.writeChunk(data);
        address[] memory pointers = new address[](1); pointers[0] = pointer;
        bytes32[] memory hashes = new bytes32[](1); hashes[0] = hash;
        return registry.registerContent(mime, "identity", data.length, pointers, hashes);
    }
    function _buy(address user, uint256 gross) private returns (uint256 result) {
        vm.prank(user); return market.buy{value: gross}(0, block.timestamp);
    }
    function _sell(address user, uint256 amount) private returns (uint256 result) {
        vm.startPrank(user);
        token.approve(address(market), amount);
        result = market.sell(amount, 0, block.timestamp);
        vm.stopPrank();
    }
    function _solvent() private view {
        _eq(address(market).balance, market.reserveETH() + market.totalPendingETH());
        _eq(token.balanceOf(address(market)), market.inventory());
        _assert(market.reserveETH() <= market.capETH());
        _assert(market.inventory() <= SUPPLY);
    }

    function testContentBytesMetadataAndStopPrefix() public view {
        (uint8 version, string memory mime, string memory encoding, uint256 length, address registrant,
            address[] memory pointers, bytes32[] memory hashes) = registry.getContent(imageRoot);
        _eq(version, 1); _eq(keccak256(bytes(mime)), keccak256("image/svg+xml"));
        _eq(keccak256(bytes(encoding)), keccak256("identity")); _eq(length, 11);
        _eq(registrant, address(this)); _eq(keccak256(registry.read(imageRoot)), keccak256("<svg></svg>"));
        _eq(hashes[0], keccak256("<svg></svg>")); _eq(pointers[0].code.length, 12);
        _eq(uint8(pointers[0].code[0]), 0);
        _eq(keccak256(registry.readChunk(pointers[0])), hashes[0]);
        _eq(imageRoot, keccak256(abi.encode(uint8(1), mime, encoding, length, pointers, hashes)));
    }

    function testChunkDeduplication() public {
        (address a, bytes32 ah) = registry.writeChunk(bytes("abc"));
        (address b, bytes32 bh) = registry.writeChunk(bytes("abc"));
        _eq(a, b); _eq(ah, bh);
    }

    function testChunkLimits() public {
        vm.expectRevert(CarveContentRegistry.InvalidChunk.selector); registry.writeChunk("");
        vm.expectRevert(CarveContentRegistry.InvalidChunk.selector); registry.writeChunk(new bytes(20_481));
        (address p,) = registry.writeChunk(new bytes(20_480)); _eq(p.code.length, 20_481);
    }

    function testUnknownContentAndPointer() public {
        vm.expectRevert(CarveContentRegistry.UnknownContent.selector); registry.read(bytes32(uint256(9)));
        vm.expectRevert(CarveContentRegistry.UnknownContent.selector); registry.getContent(bytes32(uint256(9)));
        vm.expectRevert(CarveContentRegistry.InvalidChunk.selector); registry.readChunk(BOB);
    }

    function testInvalidManifestHashLengthPointerAndEncoding() public {
        (address p, bytes32 h) = registry.writeChunk("abc");
        address[] memory ps = new address[](1); ps[0] = p;
        bytes32[] memory hs = new bytes32[](1); hs[0] = h;
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("x", "identity", 4, ps, hs);
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("x", "br", 3, ps, hs);
        hs[0] = bytes32(uint256(1));
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("x", "identity", 3, ps, hs);
        hs[0] = h; ps[0] = BOB;
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("x", "identity", 3, ps, hs);
    }

    function testManifestCountAndMimeBounds() public {
        address[] memory ps = new address[](0); bytes32[] memory hs = new bytes32[](0);
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("x", "identity", 1, ps, hs);
        ps = new address[](129); hs = new bytes32[](129);
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("x", "identity", 1, ps, hs);
        (address p, bytes32 h) = registry.writeChunk("abc");
        ps = new address[](1); ps[0] = p; hs = new bytes32[](1); hs[0] = h;
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("", "identity", 3, ps, hs);
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent(string(new bytes(97)), "identity", 3, ps, hs);
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("x", "identity", 3, ps, new bytes32[](0));
    }

    function testChunkOrderAndMetadataAreCommitted() public {
        (address a, bytes32 ah) = registry.writeChunk("abc"); (address b, bytes32 bh) = registry.writeChunk("def");
        address[] memory ps = new address[](2); ps[0] = a; ps[1] = b;
        bytes32[] memory hs = new bytes32[](2); hs[0] = ah; hs[1] = bh;
        bytes32 first = registry.registerContent("text/plain", "identity", 6, ps, hs);
        _eq(keccak256(registry.read(first)), keccak256("abcdef"));
        ps[0] = b; ps[1] = a;
        vm.expectRevert(CarveContentRegistry.InvalidManifest.selector); registry.registerContent("text/plain", "identity", 6, ps, hs);
        hs[0] = bh; hs[1] = ah;
        bytes32 reversed = registry.registerContent("text/plain", "identity", 6, ps, hs);
        bytes32 encodingChanged = registry.registerContent("text/plain", "gzip", 6, ps, hs);
        bytes32 mimeChanged = registry.registerContent("text/html", "identity", 6, ps, hs);
        _assert(first != reversed && reversed != encodingChanged && reversed != mimeChanged);
        _eq(keccak256(registry.read(reversed)), keccak256("defabc"));
        _eq(keccak256(registry.read(first)), keccak256("abcdef"));
    }

    function testRegistrationFinalAndDuplicateRejected() public {
        (,, , uint256 n,, address[] memory ps, bytes32[] memory hs) = registry.getContent(imageRoot);
        vm.expectRevert(CarveContentRegistry.ContentAlreadyRegistered.selector);
        registry.registerContent("image/svg+xml", "identity", n, ps, hs);
        (bool ok,) = address(registry).call(abi.encodeWithSignature("updateContent(bytes32,bytes)", imageRoot, bytes("changed")));
        _assert(!ok); _eq(keccak256(registry.read(imageRoot)), keccak256("<svg></svg>"));
    }

    function testFixedSupplyCreatorAndContentAttribution() public view {
        _eq(token.totalSupply(), SUPPLY); _eq(token.balanceOf(address(market)), SUPPLY);
        _eq(token.creator(), ALICE); _eq(market.creator(), ALICE); _eq(market.factory(), address(factory));
        _eq(token.contentRegistry(), address(registry)); _eq(token.imageRoot(), imageRoot);
        _eq(token.audioRoot(), audioRoot); _eq(token.websiteRoot(), websiteRoot);
        _eq(factory.marketForToken(address(token)), address(market)); _eq(factory.marketCount(), 1);
    }

    function testAtomicInitialBuyAndCreatorAttribution() public {
        vm.prank(BOB);
        (address t, address m) = factory.launch{value: CREATION_FEE + 1 ether}("Initial", "INIT", imageRoot, audioRoot, websiteRoot, 1, block.timestamp);
        _eq(CarveToken(t).creator(), BOB); _eq(CarveMarket(m).creator(), BOB);
        _assert(CarveToken(t).balanceOf(BOB) > 0); _eq(CarveToken(t).balanceOf(address(factory)), 0);
        _eq(CarveMarket(m).reserveETH(), 0.99 ether); _eq(CarveMarket(m).pendingETH(BOB), 0.002 ether);
        _eq(factory.pendingETH(TREASURY), CREATION_FEE * 2);
    }

    function testRevertedInitialBuyIsFullyAtomic() public {
        uint256 balance = BOB.balance;
        vm.prank(BOB); vm.expectRevert(CarveMarket.Slippage.selector);
        factory.launch{value: CREATION_FEE + 1 ether}("Bad", "BAD", imageRoot, 0, 0, SUPPLY, block.timestamp);
        _eq(factory.marketCount(), 1); _eq(factory.pendingETH(TREASURY), CREATION_FEE); _eq(BOB.balance, balance);
    }

    function testLaunchValidation() public {
        vm.expectRevert(CarveFactory.InvalidContent.selector);
        factory.launch{value: CREATION_FEE}("A", "A", 0, 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveFactory.InvalidContent.selector);
        factory.launch{value: CREATION_FEE}("A", "A", imageRoot, bytes32(uint256(1)), 0, 0, block.timestamp);
        vm.expectRevert(CarveFactory.InvalidLaunch.selector);
        factory.launch{value: CREATION_FEE}("", "A", imageRoot, 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveFactory.InsufficientCreationFee.selector);
        factory.launch("A", "A", imageRoot, 0, 0, 0, block.timestamp);
        vm.expectRevert(CarveMarket.Slippage.selector);
        factory.launch{value: CREATION_FEE}("A", "A", imageRoot, 0, 0, 1, block.timestamp);
    }

    function testConfigBoundsAndNoAdminFunctions() public {
        CarveMarket.Config memory config = _config(); config.supply = 1e36 + 1;
        vm.expectRevert(CarveFactory.InvalidLaunch.selector); new CarveFactory(registry, 0, config);
        config = _config(); config.virtualETH = 0;
        vm.expectRevert(CarveFactory.InvalidLaunch.selector); new CarveFactory(registry, 0, config);
        config = _config(); config.capETH = 1e30 + 1;
        vm.expectRevert(CarveFactory.InvalidLaunch.selector); new CarveFactory(registry, 0, config);
        config = _config(); config.tradeFeeBps = 1_001;
        vm.expectRevert(CarveFactory.InvalidLaunch.selector); new CarveFactory(registry, 0, config);
        config = _config(); config.creatorFeeShareBps = 10_001;
        vm.expectRevert(CarveFactory.InvalidLaunch.selector); new CarveFactory(registry, 0, config);
        config = _config(); config.protocolRecipient = address(0);
        vm.expectRevert(CarveFactory.InvalidLaunch.selector); new CarveFactory(registry, 0, config);
        (bool minted,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", ALICE, 1));
        (bool changed,) = address(factory).call(abi.encodeWithSignature("setTradeFee(uint256)", 10_000));
        (bool seized,) = address(market).call(abi.encodeWithSignature("withdrawReserves(address)", ALICE));
        _assert(!minted && !changed && !seized);
    }

    function testBuyQuoteFeesAndAccounting() public {
        (uint256 expected, uint256 accepted, uint256 fee, uint256 refund) = market.quoteBuy(1 ether);
        _eq(accepted, 1 ether); _eq(fee, 0.01 ether); _eq(refund, 0);
        _eq(_buy(BOB, 1 ether), expected); _eq(token.balanceOf(BOB), expected);
        _eq(market.reserveETH(), 0.99 ether); _eq(market.pendingETH(ALICE), 0.002 ether);
        _eq(market.pendingETH(TREASURY), 0.008 ether); _solvent();
    }

    function testRoundTripNoProfitAndFeesStaySeparate() public {
        uint256 amount = _buy(BOB, 1 ether);
        (uint256 quoted, uint256 fee) = market.quoteSell(amount);
        uint256 proceeds = _sell(BOB, amount);
        _eq(proceeds, quoted); _assert(proceeds < 1 ether); _eq(market.pendingETH(BOB), proceeds);
        _eq(market.inventory(), SUPPLY); _assert(market.reserveETH() <= 2);
        _assert(fee > 0); _solvent();
        uint256 before = BOB.balance;
        vm.prank(BOB); market.withdrawETH(payable(BOB));
        _eq(BOB.balance, before + proceeds); _eq(market.pendingETH(BOB), 0); _solvent();
    }

    function testBuySlippageDeadlineAndZeroRevert() public {
        vm.expectRevert(CarveMarket.Slippage.selector); market.buy{value: 1 ether}(SUPPLY, block.timestamp);
        vm.warp(1_000);
        vm.expectRevert(CarveMarket.DeadlineExpired.selector); market.buy{value: 1 ether}(0, 999);
        vm.expectRevert(CarveMarket.ZeroTrade.selector); market.buy(0, 1_000);
        vm.expectRevert(CarveMarket.ZeroTrade.selector); market.buy{value: 1}(0, 1_000);
        _eq(market.reserveETH(), 0); _solvent();
    }

    function testSellSlippageDeadlineAmountAndAllowanceRevert() public {
        uint256 amount = _buy(BOB, 1 ether);
        vm.startPrank(BOB); token.approve(address(market), amount);
        vm.expectRevert(CarveMarket.Slippage.selector); market.sell(amount, 1 ether, block.timestamp);
        vm.warp(1_000);
        vm.expectRevert(CarveMarket.DeadlineExpired.selector); market.sell(amount, 0, 999);
        vm.expectRevert(CarveMarket.ZeroTrade.selector); market.sell(0, 0, 1_000);
        vm.expectRevert(CarveMarket.InvalidAmount.selector); market.sell(amount + 1, 0, 1_000);
        token.approve(address(market), 0);
        vm.expectRevert(CarveToken.InsufficientAllowance.selector); market.sell(amount, 0, 1_000);
        vm.stopPrank(); _eq(token.balanceOf(BOB), amount); _solvent();
    }

    function testFinalBuyCappedRefundAndCapStateSafe() public {
        (uint256 quoted, uint256 accepted, uint256 fee, uint256 refund) = market.quoteBuy(100 ether);
        uint256 result = _buy(BOB, 100 ether);
        _eq(result, quoted); _eq(accepted + refund, 100 ether); _eq(accepted - fee, 20 ether);
        _eq(market.reserveETH(), market.capETH()); _assert(market.capReached());
        _eq(market.pendingETH(BOB), refund); _assert(!market.graduationEnabled()); _solvent();
        vm.expectRevert(CarveMarket.CapReached.selector); market.buy{value: 1 ether}(0, block.timestamp);
        (uint256 emptyTokens, uint256 emptyAccepted,, uint256 capRefund) = market.quoteBuy(1 ether);
        _eq(emptyTokens, 0); _eq(emptyAccepted, 0); _eq(capRefund, 1 ether);
        _sell(BOB, result / 2); _assert(!market.capReached()); _buy(BOB, 1 ether); _solvent();
    }

    function testNoFalseGraduationOrMigrationEndpoint() public {
        _buy(BOB, 100 ether);
        (bool graduated,) = address(market).call(abi.encodeWithSignature("graduate()"));
        (bool migrated,) = address(market).call(abi.encodeWithSignature("migrate(address)", TREASURY));
        _assert(!graduated && !migrated && !market.graduationEnabled()); _solvent();
    }

    function testRefundCanBeWithdrawnAtCap() public {
        _buy(BOB, 100 ether); uint256 refund = market.pendingETH(BOB); uint256 before = BOB.balance;
        vm.prank(BOB); market.withdrawETH(payable(BOB));
        _eq(BOB.balance, before + refund); _eq(market.reserveETH(), 20 ether); _solvent();
    }

    function testUnauthorizedCreditWithdrawalAndPrincipalIsolation() public {
        _buy(BOB, 1 ether);
        vm.prank(BOB); vm.expectRevert(CarveEscrow.NoCredit.selector); market.withdrawETH(payable(BOB));
        vm.prank(BOB); vm.expectRevert(CarveEscrow.NoCredit.selector); factory.withdrawETH(payable(BOB));
        uint256 reserve = market.reserveETH();
        vm.prank(ALICE); market.withdrawETH(payable(ALICE));
        vm.prank(TREASURY); market.withdrawETH(payable(TREASURY));
        _eq(market.reserveETH(), reserve); _eq(address(market).balance, reserve);
        vm.prank(TREASURY); factory.withdrawETH(payable(TREASURY)); _eq(address(factory).balance, 0);
    }

    function testRejectingRecipientCannotBlockTradingAndCanRedirectWithdrawal() public {
        RejectingAndReenteringReceiver receiver = new RejectingAndReenteringReceiver();
        receiver.configure(market, true, false); receiver.buy{value: 1 ether}(); receiver.sellAll();
        uint256 pending = market.pendingETH(address(receiver)); _assert(pending > 0);
        vm.expectRevert(CarveEscrow.ETHTransferFailed.selector); receiver.withdraw(payable(address(receiver)));
        _eq(market.pendingETH(address(receiver)), pending);
        uint256 before = BOB.balance; receiver.withdraw(payable(BOB)); _eq(BOB.balance, before + pending); _solvent();
    }

    function testWithdrawalReentrancyBlocked() public {
        RejectingAndReenteringReceiver receiver = new RejectingAndReenteringReceiver();
        receiver.configure(market, false, true); receiver.buy{value: 1 ether}(); receiver.sellAll();
        uint256 pending = market.pendingETH(address(receiver)); receiver.withdraw(payable(address(receiver)));
        _eq(address(receiver).balance, pending); _eq(market.pendingETH(address(receiver)), 0);
        _assert(!receiver.reentrySucceeded()); _solvent();
    }

    function testZeroRecipientWithdrawalPreservesCredit() public {
        _buy(BOB, 1 ether);
        vm.prank(ALICE); vm.expectRevert(CarveEscrow.InvalidRecipient.selector); market.withdrawETH(payable(address(0)));
        _eq(market.pendingETH(ALICE), 0.002 ether); _solvent();
    }

    function testERC20AllowanceTransferAndNoZeroRecipient() public {
        uint256 amount = _buy(BOB, 1 ether);
        vm.startPrank(BOB); token.transfer(ALICE, amount / 2); token.approve(address(this), type(uint256).max);
        vm.expectRevert(CarveToken.InvalidAddress.selector); token.transfer(address(0), 1);
        vm.expectRevert(CarveToken.InsufficientBalance.selector); token.transfer(ALICE, amount);
        vm.stopPrank(); token.transferFrom(BOB, ALICE, 1);
        _eq(token.allowance(BOB, address(this)), type(uint256).max);
        _eq(token.balanceOf(ALICE), amount / 2 + 1);
    }

    function testDonatedTokensCannotMoveCurvePrice() public {
        uint256 amount = _buy(BOB, 1 ether);
        (uint256 beforeQuote,,,) = market.quoteBuy(1 ether);
        vm.prank(BOB); token.transfer(address(market), amount / 2);
        (uint256 afterQuote,,,) = market.quoteBuy(1 ether); _eq(beforeQuote, afterQuote);
        _eq(token.balanceOf(address(market)), market.inventory() + amount / 2);
    }

    function testMaxBoundsQuoteWithoutOverflow() public {
        CarveMarket.Config memory config = CarveMarket.Config(1e36, 1e30, 1e30, 1_000, 10_000, TREASURY);
        CarveFactory f = new CarveFactory(registry, 0, config);
        (, address m) = f.launch("Max", "MAX", imageRoot, 0, 0, 0, block.timestamp);
        (uint256 out, uint256 accepted, uint256 fee, uint256 refund) = CarveMarket(m).quoteBuy(type(uint256).max);
        _eq(out, 5e35); _eq(accepted - fee, 1e30); _eq(accepted + refund, type(uint256).max);
    }

    function testZeroFeeCurveSupported() public {
        CarveMarket.Config memory config = _config(); config.tradeFeeBps = 0;
        CarveFactory f = new CarveFactory(registry, 0, config);
        (address t, address m) = f.launch{value: 1 ether}("Zero", "ZERO", imageRoot, 0, 0, 1, block.timestamp);
        CarveToken(t).approve(m, type(uint256).max);
        uint256 out = CarveMarket(m).sell(CarveToken(t).balanceOf(address(this)), 0, block.timestamp);
        _assert(out <= 1 ether && out >= 1 ether - 2); _eq(CarveMarket(m).pendingETH(TREASURY), 0);
    }

    function testFuzzRoundTripCannotProfit(uint96 seed) public {
        uint256 gross = uint256(seed) % (20 ether) + 10_000;
        uint256 amount = _buy(BOB, gross); uint256 out = _sell(BOB, amount);
        _assert(out <= gross); _eq(token.balanceOf(BOB), 0); _eq(market.inventory(), SUPPLY); _solvent();
    }

    function testFuzzConstantProductNeverDecreases(uint96 seed, uint64 fraction) public {
        uint256 beforeK = market.inventory() * (market.virtualETH() + market.reserveETH());
        uint256 amount = _buy(BOB, uint256(seed) % (20 ether) + 10_000);
        uint256 buyK = market.inventory() * (market.virtualETH() + market.reserveETH());
        _assert(buyK >= beforeK);
        uint256 sold = amount * (uint256(fraction) % 9_000 + 1_000) / 10_000;
        _sell(BOB, sold);
        uint256 sellK = market.inventory() * (market.virtualETH() + market.reserveETH());
        _assert(sellK >= buyK); _solvent();
    }

    function testFuzzCappedBuyPreciseAccounting(uint96 seed) public {
        uint256 gross = uint256(seed) % (200 ether) + 21 ether;
        (, uint256 accepted, uint256 fee, uint256 refund) = market.quoteBuy(gross);
        _buy(BOB, gross);
        _eq(market.reserveETH(), 20 ether); _eq(accepted - fee, 20 ether);
        _eq(refund + accepted, gross); _eq(market.pendingETH(BOB), refund); _solvent();
    }

    function testFuzzMixedTradingMaintainsSolvency(uint256 seed) public {
        for (uint256 i; i < 16; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address user = seed & 1 == 0 ? ALICE : BOB;
            uint256 balance = token.balanceOf(user);
            if (balance > 1e12 && (seed >> 1) & 1 == 1) _sell(user, balance / 2);
            else if (!market.capReached()) _buy(user, seed % (3 ether) + 10_000);
            _solvent();
        }
    }
}
