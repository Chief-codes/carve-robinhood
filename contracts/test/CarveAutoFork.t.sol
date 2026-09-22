// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveContentRegistry} from "../src/CarveContentRegistry.sol";
import {CarveToken} from "../src/CarveToken.sol";
import {CarveInlineContent} from "../src/v3/CarveInlineContent.sol";
import {CarveAutoFactory} from "../src/auto/CarveAutoFactory.sol";
import {CarveAutoMarket} from "../src/auto/CarveAutoMarket.sol";
import {CarveAutoEngine, ICarvePositionManager} from "../src/auto/CarveAutoEngine.sol";
import {CarveAutoRouter} from "../src/auto/CarveAutoRouter.sol";
import {ICarveMigrationAdapterV2} from "../src/interfaces/ICarveMigrationAdapterV2.sol";

interface CurveVm {
    function deal(address, uint256) external;
    function getNonce(address) external view returns (uint64);
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function mockCallRevert(address, bytes calldata, bytes calldata) external;
    function clearMockedCalls() external;
    function skip(bool) external;
    function prank(address) external;
}
interface AutoClaimCore { function balanceOf(address owner,uint256 currency) external view returns(uint256); }

contract CurveRejectReceiver {
    receive() external payable { revert("no native receiver"); }
    function sell(CarveAutoMarket market, CarveToken token, uint256 amount) external {
        token.approve(address(market), amount);
        market.sell(amount, 1, block.timestamp);
    }
    function withdraw(CarveAutoMarket market, address payable recipient) external { market.withdrawETH(recipient); }
}

/// @notice Read-only fork suite against the actual canonical NFPM, Permit2 and PoolManager.
/// No mock protocol replaces the chain's contracts. Targeted failure mocks are cleared before retry.
contract CarveAutoForkTest {
    CurveVm private constant vm = CurveVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant NFPM = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address private constant PLATFORM = address(0xCA12E);
    CarveContentRegistry private registry;
    CarveAutoFactory private factory;
    CarveAutoEngine private engine;
    CarveAutoRouter private router;
    CarveAutoMarket private market;
    CarveToken private token;

    receive() external payable {}

    function setUp() public {
        vm.skip(NFPM.code.length == 0);
        require(block.chainid == 4663, "Robinhood fork required");
        vm.deal(address(this), 100 ether);
        registry = new CarveContentRegistry();
        uint64 nonce = vm.getNonce(address(this)) + 1;
        require(nonce < 128, "bounded factory prediction");
        address predicted = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), uint8(nonce))))));
        bytes32 initHash = keccak256(abi.encodePacked(type(CarveAutoEngine).creationCode, abi.encode(PM, predicted)));
        bytes32 salt;
        for (uint256 i; ; ++i) {
            salt = bytes32(i);
            address candidate = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initHash)))));
            if ((uint160(candidate) & 0x3fff) == 0x2044) break;
        }
        engine = new CarveAutoEngine{salt: salt}(PM, predicted);
        factory = new CarveAutoFactory(registry, PLATFORM, address(engine));
        require(address(factory) == predicted, "immutable factory binding");
        router = new CarveAutoRouter(engine);
    }

    function _assets() private pure returns (CarveInlineContent.Asset[3] memory a) {
        a[0] = CarveInlineContent.Asset(0, "image/png", "identity", hex"89504e470d0a1a0a");
        a[1] = CarveInlineContent.Asset(0, "audio/wav", "identity", bytes("RIFF-carve-test"));
        a[2] = CarveInlineContent.Asset(0, "text/html", "identity", bytes("<!doctype html><h1>Carve</h1>"));
    }

    function _launch(uint256 buy, uint16 fee) private {
        (address t, address m) = factory.launchInline{value: 0.0005 ether + buy}(
            "Carve curve verification", "CURVE", _assets(), fee, false, buy == 0 ? 0 : 1, block.timestamp + 300);
        token = CarveToken(t); market = CarveAutoMarket(payable(m));
    }

    function _graduate() private returns (ICarveMigrationAdapterV2.MigrationReceipt memory r) {
        market.buy{value: 5 ether}(1, block.timestamp + 300);
        require(uint8(market.phase()) == 2, "automatic migration succeeded");
        r = market.graduationReceipt();
        require(engine.verifyPosition(address(market)), "real NFPM position exists and is locked");
    }

    function testZeroDevBuyDoesNotInventLiquidity() public {
        _launch(0, 0);
        require(token.totalSupply() == 1e27 && market.inventory() == 1e27, "fixed supply");
        require(market.reserveETH() == 0 && address(market).balance == 0, "zero real ETH");
        require(token.balanceOf(address(this)) == 0 && market.virtualETH() == 1.68 ether, "virtual not real");
    }

    function testPoint01DevBuyAndAllMediaOneCall() public {
        _launch(0.01 ether, 0);
        require(market.reserveETH() == 0.0099 ether, "real ETH after 1% fee");
        require(token.balanceOf(address(this)) == uint256(1e27) * 99 / 16899, "Pons initial price equation");
        require(token.creator() == address(this), "user remains creator");
        require(token.imageRoot() != 0 && token.audioRoot() != 0 && token.websiteRoot() != 0, "all roots immutable");
        require(keccak256(registry.read(token.websiteRoot())) == keccak256(_assets()[2].data), "exact HTML bytes");
        require(factory.marketCount() == 1 && factory.marketForToken(address(token)) == address(market), "discoverable launch");
    }

    function testAllSevenMediaCombinations() public {
        for (uint256 mask = 1; mask < 8; ++mask) {
            CarveInlineContent.Asset[3] memory a = _assets();
            for (uint256 i; i < 3; ++i) if (mask & (1 << i) == 0) delete a[i];
            (address t,) = factory.launchInline{value: 0.0005 ether}("Media", "MEDIA", a, 0, false, 0, block.timestamp);
            CarveToken x = CarveToken(t);
            require((x.imageRoot() != 0) == (mask & 1 != 0), "image choice");
            require((x.audioRoot() != 0) == (mask & 2 != 0), "audio choice");
            require((x.websiteRoot() != 0) == (mask & 4 != 0), "website choice");
        }
    }

    function testUsersChooseDevBuyAndCreatorFee() public {
        _launch(0.1 ether, 200);
        require(market.reserveETH() == 0.097 ether, "1% platform plus 2% creator");
        require(market.pendingETH(PLATFORM) == 0.001 ether && market.pendingETH(address(this)) == 0.002 ether, "separate revenue");
        _launch(0.5 ether, 0);
        require(market.reserveETH() == 0.495 ether, "independent chosen buy");
    }

    function testNativeSalePaidWithoutExtraWithdrawal() public {
        _launch(0.01 ether, 0);
        uint256 amount = token.balanceOf(address(this));
        (uint256 quote,,) = market.quoteSell(amount);
        token.approve(address(market), amount);
        uint256 beforeETH = address(this).balance;
        market.sell(amount, quote, block.timestamp);
        require(address(this).balance == beforeETH + quote, "ETH directly in wallet");
        require(market.pendingETH(address(this)) == 0, "no manual claim");
    }

    function testRejectingReceiverKeepsRecoverableCredit() public {
        _launch(0.01 ether, 0);
        CurveRejectReceiver recipient = new CurveRejectReceiver();
        uint256 amount = token.balanceOf(address(this));
        token.transfer(address(recipient), amount);
        (uint256 quote,,) = market.quoteSell(amount);
        recipient.sell(market, token, amount);
        require(market.pendingETH(address(recipient)) == quote, "fallback owns exact credit");
        uint256 beforeETH = address(this).balance;
        recipient.withdraw(market, payable(address(this)));
        require(address(this).balance == beforeETH + quote, "fallback recoverable");
    }

    function testOverCapDevBuyRefundsAndSeedsCanonicalNFT() public {
        uint256 beforeETH = address(this).balance;
        _launch(5 ether, 0);
        require(uint8(market.phase()) == 2 && engine.verifyPosition(address(market)), "launch graduates atomically");
        require(beforeETH - address(this).balance < 4.25 ether, "unused buy ETH refunded directly");
        require(market.pendingETH(address(this)) == 0, "no refund claim needed");
        ICarveMigrationAdapterV2.MigrationReceipt memory r = market.graduationReceipt();
        require(r.ethSpent + r.lockedETH == 4.2 ether, "all real reserve reconciled");
        require(r.tokensSpent > 204_081_632e18 && r.tokensSpent < 204_081_633e18, "Pons supply/liquidity ratio");
        require(r.lockedTokens > 81_632_652e18 && r.lockedTokens < 81_632_654e18, "unsold allocation locked");
        require(ICarvePositionManager(NFPM).ownerOf(engine.positionForMarket(address(market))) == address(engine), "permanent NFT custody");
    }

    function testGraduatedBuyAndSellRouteReturnsNativeETH() public {
        _launch(0.01 ether, 0); _graduate();
        (,uint256 bought) = router.swapExactInput{value: 0.01 ether}(address(token), true, 0.01 ether, 1, 0, block.timestamp);
        require(bought > 0, "post-graduation buy");
        token.approve(address(router), bought);
        uint256 beforeETH = address(this).balance;
        (,uint256 sold) = router.swapExactInput(address(token), false, bought, 1, 0, block.timestamp);
        require(address(this).balance == beforeETH + sold && router.pendingETH(address(this)) == 0, "post-graduation native sell");
        require(engine.verifyPosition(address(market)), "trading preserves locked position");
    }

    function testMigrationFailureRetainsFundsAndRetrySucceeds() public {
        _launch(0.01 ether, 0);
        vm.mockCallRevert(NFPM, abi.encodeWithSelector(ICarvePositionManager.modifyLiquidities.selector), bytes("transient failure"));
        market.buy{value: 5 ether}(1, block.timestamp);
        require(uint8(market.phase()) == 0 && market.reserveETH() == 4.2 ether, "crossing trade survives");
        require(address(market).balance >= market.reserveETH() + market.totalPendingETH(), "all reserves and claims remain");
        require(engine.positionForMarket(address(market)) == 0, "no phantom position");
        vm.clearMockedCalls();
        market.graduate(1, block.timestamp);
        require(uint8(market.phase()) == 2 && engine.verifyPosition(address(market)), "permissionless retry");
    }

    function testInvalidEmptyAndOverLimitContentReverts() public {
        CarveInlineContent.Asset[3] memory empty;
        vm.expectRevert();
        factory.launchInline{value: 0.0005 ether}("Empty", "EMPTY", empty, 0, false, 0, block.timestamp);
        CarveInlineContent.Asset[3] memory a = _assets(); a[0].data = new bytes(24577);
        vm.expectRevert();
        factory.launchInline{value: 0.0005 ether}("Large", "LARGE", a, 0, false, 0, block.timestamp);
        require(factory.marketCount() == 0, "no half launch");
    }

    function testTokenDonationsCannotChangePricingOrReserveCap() public {
        _launch(0.01 ether, 0);
        (uint256 beforeQuote,,,,) = market.quoteBuy(0.01 ether);
        token.transfer(address(market), token.balanceOf(address(this)) / 2);
        (uint256 afterQuote,,,,) = market.quoteBuy(0.01 ether);
        require(beforeQuote == afterQuote && market.reserveETH() == 0.0099 ether, "tracked not raw inventory");
    }

    function testSlippageAndSelfEntryCannotSpendWalletFunds() public {
        _launch(0.01 ether, 0);
        vm.expectRevert(CarveAutoMarket.OnlySelf.selector); market.completeGraduation(block.timestamp);
        uint256 beforeETH = address(this).balance;
        vm.expectRevert(CarveAutoMarket.Slippage.selector); market.buy{value: 0.01 ether}(type(uint256).max, block.timestamp);
        require(address(this).balance == beforeETH, "reverted trade costs no principal");
    }

    function _launchAuto(uint256 initialBuy) private {
        (address t,address m)=factory.launchInline{value:0.0005 ether+initialBuy}(
            "Auto burn", "AUTO", _assets(), 100, true, 1, block.timestamp+300);
        token=CarveToken(t);market=CarveAutoMarket(payable(m));
    }
    function testAutoCreatorSplitAndTradeTriggeredCurveBuyback() public {
        _launchAuto(0.1 ether);
        require(market.pendingETH(PLATFORM)==0.001 ether,"platform unchanged");
        require(market.pendingETH(address(this))==0.0002 ether,"20 percent creator revenue");
        require(market.pendingBuybackETH()==0.0008 ether,"80 percent reserved");
        require(token.balanceOf(market.BURN_ADDRESS())==0,"constructor does not run callback");
        market.buy{value:0.1 ether}(1,block.timestamp+300);
        require(market.totalBuybackETH()>0,"trade triggers buyback");
        require(token.balanceOf(market.BURN_ADDRESS())==market.totalTokensBurned(),"bought tokens locked");
        require(token.totalSupply()==1e27,"dead-address burn keeps nominal supply");
        require(address(market).balance==market.reserveETH()+market.totalPendingETH()+market.pendingBuybackETH(),"all ETH reconciles");
    }
    function testAutoFailedBuybackNeverBlocksCurveTrade() public {
        _launchAuto(0.1 ether);
        vm.mockCallRevert(address(market),abi.encodeWithSelector(market.processBuyback.selector),hex"dead");
        uint256 beforeTokens=token.balanceOf(address(this));
        market.buy{value:0.1 ether}(1,block.timestamp+300);
        require(token.balanceOf(address(this))>beforeTokens,"user trade completed");
        require(market.pendingBuybackETH()==0.0016 ether,"budget retained");
        require(market.totalBuybackETH()==0,"failed attempt not counted");
        vm.clearMockedCalls();
        market.buy{value:0.01 ether}(1,block.timestamp+300);
        require(market.totalBuybackETH()>0,"next trade retries automatically");
    }
    function testAutoSellTriggersAndPublicProcessCannotBeAbused() public {
        _launchAuto(0.1 ether);
        vm.expectRevert();market.processBuyback();
        vm.expectRevert();market.releaseBuybackToEngine();
        token.approve(address(market),type(uint256).max);
        market.sell(token.balanceOf(address(this))/5,1,block.timestamp+300);
        require(market.totalBuybackETH()>0,"sell triggers buyback");
        require(address(market).balance==market.reserveETH()+market.totalPendingETH()+market.pendingBuybackETH(),"sell conservation");
    }
    function testAutoMigratesWithBudgetAndBurnsOnRealV4Trades() public {
        _launchAuto(0.1 ether);
        _graduate();
        require(market.pendingBuybackETH()>0,"curve budget preserved through migration");
        router.swapExactInput{value:0.01 ether}(address(token),true,0.01 ether,1,0,block.timestamp+300);
        require(market.pendingBuybackETH()==0,"curve budget moved to same-token engine");
        require(engine.totalBuybackETH(address(market))>0,"hook-triggered buyback");
        require(engine.totalTokensBurned(address(market))>0,"native buyback and token fees burned");
        require(token.balanceOf(market.BURN_ADDRESS())==market.totalTokensBurned()+engine.totalTokensBurned(address(market)),"burn accounting");
        require(engine.verifyPosition(address(market)),"LP stays locked");
        require(AutoClaimCore(PM).balanceOf(address(engine),0)==engine.totalFeeCredit(address(0))+engine.pendingBuybackETH(address(market)),"native claims backed exactly");
        require(AutoClaimCore(PM).balanceOf(address(engine),uint160(address(token)))==engine.totalFeeCredit(address(token))+engine.pendingBurnTokens(address(market)),"token claims backed exactly");
        token.approve(address(router),type(uint256).max);
        uint256 spent=engine.totalBuybackETH(address(market));
        router.swapExactInput(address(token),false,token.balanceOf(address(this))/100,1,0,block.timestamp+300);
        require(engine.totalBuybackETH(address(market))>spent,"v4 sell triggers");
    }
    function testAutoHookFailureKeepsTraderLiveAndCreditsBacked() public {
        _launchAuto(0.1 ether);_graduate();
        vm.mockCallRevert(address(engine),abi.encodeWithSelector(engine.processBuyback.selector,address(market)),hex"dead");
        router.swapExactInput{value:0.01 ether}(address(token),true,0.01 ether,1,0,block.timestamp+300);
        require(engine.totalBuybackETH(address(market))==0,"failure uncounted");
        require(engine.pendingBurnTokens(address(market))>0,"token fee preserved");
        vm.clearMockedCalls();
        router.swapExactInput{value:0.01 ether}(address(token),true,0.01 ether,1,0,block.timestamp+300);
        require(engine.totalBuybackETH(address(market))>0,"later trade retries");
    }
    function testAutoTwoMarketsNeverShareBudgets() public {
        _launchAuto(0.1 ether);_graduate();
        address first=address(market);
        uint256 untouched=market.pendingBuybackETH();
        _launchAuto(0.1 ether);_graduate();
        router.swapExactInput{value:0.01 ether}(address(token),true,0.01 ether,1,0,block.timestamp+300);
        require(CarveAutoMarket(payable(first)).pendingBuybackETH()==untouched,"other curve budget untouched");
        require(engine.totalBuybackETH(first)==0 && engine.totalTokensBurned(first)==0,"no cross-token processing");
    }
    function testAutoMaximumCreatorFeeAndExactOutput() public {
        (address t,address m)=factory.launchInline{value:0.1005 ether}("Max", "MAX", _assets(),1000,true,1,block.timestamp+300);
        token=CarveToken(t);market=CarveAutoMarket(payable(m));
        require(market.pendingETH(address(this))==0.002 ether,"max fee split");
        _graduate();
        router.swapExactOutput{value:0.1 ether}(address(token),true,100e18,0.1 ether,0,block.timestamp+300);
        require(engine.totalBuybackETH(m)>0,"exact output auto buyback");
        token.approve(address(router),type(uint256).max);
        router.swapExactOutput(address(token),false,0.00001 ether,token.balanceOf(address(this)),0,block.timestamp+300);
        require(engine.verifyPosition(m),"exact out did not touch principal");
    }
    function testAutoGasEstimationCannotSelectAlwaysSkipPath() public {
        _launchAuto(0.1 ether);
        vm.expectRevert();
        market.buy{value:0.01 ether,gas:250_000}(1,block.timestamp+300);
        require(market.totalBuybackETH()==0,"undergassed trade atomic");
        require(market.pendingBuybackETH()==0.0008 ether,"original budget retained");
        market.buy{value:0.01 ether}(1,block.timestamp+300);
        require(market.totalBuybackETH()>0,"normal gas later trade processes");
    }
    function testAutoCreatorWithdrawalCannotTakeBuybackBudget() public {
        _launchAuto(0.1 ether);
        uint256 revenue=market.pendingETH(address(this));
        market.withdrawETH(payable(address(this)));
        require(revenue==0.0002 ether && market.pendingBuybackETH()==0.0008 ether,"curve withdrawal isolated");
        _graduate();
        router.swapExactInput{value:0.01 ether}(address(token),true,0.01 ether,1,0,block.timestamp+300);
        uint256 budget=engine.pendingBuybackETH(address(market));
        if(engine.feeCredit(address(this),address(0))>0)engine.withdrawFees(address(0),payable(address(this)));
        if(engine.feeCredit(address(this),address(token))>0)engine.withdrawFees(address(token),payable(address(this)));
        require(engine.pendingBuybackETH(address(market))==budget,"engine withdrawal isolated");
        require(engine.verifyPosition(address(market)),"LP remains locked");
    }
}
