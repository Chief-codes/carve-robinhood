// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {CarveFactoryV3} from "../src/v3/CarveFactoryV3.sol";
import {CarveV3Locker} from "../src/v3/CarveV3Locker.sol";
import {CarveV3Math} from "../src/v3/CarveV3Math.sol";
import {CarveInlineContent} from "../src/v3/CarveInlineContent.sol";
import {CarveContentRegistry} from "../src/CarveContentRegistry.sol";
import {CarveToken} from "../src/CarveToken.sol";
import {CarveV3Addresses, ICarveERC20, ICarveWETH, ICarveV3Factory, ICarveV3Pool,
    ICarveV3PositionManager, ICarveV3SwapRouter} from "../src/v3/CarveV3Interfaces.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface V3CoreVm {
    function deal(address,uint256) external;
    function prank(address) external;
    function skip(bool) external;
    function warp(uint256) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}
interface V3CoreQuoter {
    struct Quote { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }
    function quoteExactInputSingle(Quote calldata) external returns (uint256,uint160,uint32,uint256);
}
interface V3IncreaseLiquidity {
    struct Params { uint256 tokenId; uint256 amount0Desired; uint256 amount1Desired;
        uint256 amount0Min; uint256 amount1Min; uint256 deadline; }
    function increaseLiquidity(Params calldata) external payable returns(uint128,uint256,uint256);
}
contract V3RejectingCreator {
    receive() external payable { revert("reject ETH"); }
    function launch(CarveFactoryV3 factory, CarveFactoryV3.LaunchParams calldata p) external payable
        returns(address,address,uint256) { return factory.launch{value:msg.value}(p); }
    function withdraw(CarveFactoryV3 factory,address payable to) external { factory.withdrawETH(to); }
}

contract CarveV3MathTest {
    function testExactBothAddressOrders() public pure {
        CarveV3Math.Plan memory a=CarveV3Math.plan(address(1),address(2));
        CarveV3Math.Plan memory b=CarveV3Math.plan(address(2),address(1));
        require(a.initialTick==-202000&&a.lower==-202000&&a.upper==887200,"token0 ticks");
        require(b.initialTick==202000&&b.lower==-887200&&b.upper==202000,"token1 ticks");
        require(a.sqrtPriceX96==3256301584989715692079494,"negative sqrt");
        require(b.sqrtPriceX96==1927678248329847372080333878109930,"positive sqrt");
        require(a.liquidity==41100304256121642060962&&a.liquidity==b.liquidity,"liquidity");
        require(a.amount0==999999999999999999999975839&&a.amount1==0,"amount0 rounding");
        require(b.amount1==999999999999999999999975959&&b.amount0==0,"amount1 rounding");
        require(a.liquidity<38350317471085141830651933667504588,"V3 max liquidity");
    }
    function testFuzzPrincipalFiniteAndMonotonic(uint24 seed,bool tokenIs0) public pure {
        CarveV3Math.Plan memory p=CarveV3Math.plan(tokenIs0?address(1):address(2),tokenIs0?address(2):address(1));
        int24 tick=p.lower+int24(uint24(seed%uint24(p.upper-p.lower)));
        (uint256 x,uint256 y)=CarveV3Math.amounts(TickMath.getSqrtPriceAtTick(tick),p.lower,p.upper,p.liquidity);
        (uint256 nextX,uint256 nextY)=CarveV3Math.amounts(TickMath.getSqrtPriceAtTick(tick+1),p.lower,p.upper,p.liquidity);
        require(nextX<=x&&nextY>=y,"monotonic at next tick");
        require((tokenIs0?x:y)<=CarveV3Math.SUPPLY,"token principal bound");
    }
    function testNoPrincipalOutsidePosition() public pure {
        CarveV3Math.Plan memory p=CarveV3Math.plan(address(1),address(2));
        (uint256 x,uint256 y)=CarveV3Math.amounts(TickMath.getSqrtPriceAtTick(p.lower-1),p.lower,p.upper,p.liquidity);
        require(x>0&&y==0,"below range");
        (x,y)=CarveV3Math.amounts(TickMath.getSqrtPriceAtTick(p.upper+1),p.lower,p.upper,p.liquidity);
        require(x==0&&y>0,"above range");
    }
}

/// @notice All integration tests use genuine canonical state on a fixed Robinhood fork, never mocked AMM code.
/// No mainnet broadcast, private key, signing, or real funds are used.
contract CarveV3CoreForkTest {
    V3CoreVm constant vm=V3CoreVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant PLATFORM=address(0xCA12E);
    address constant QUOTER=0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    CarveFactoryV3 factory;
    CarveContentRegistry registry;
    bytes32 root;
    receive() external payable {}
    function setUp() public {
        vm.skip(CarveV3Addresses.FACTORY.code.length==0);
        require(block.chainid==4663,"genuine Robinhood fork required");
        require(CarveV3Addresses.FACTORY.codehash==0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739,"factory code");
        require(CarveV3Addresses.POSITION_MANAGER.codehash==0x0a493d1af3d0f25fed8efa205244ebee14114267a08647fc38c515c7cd6ead4f,"manager code");
        require(CarveV3Addresses.SWAP_ROUTER.codehash==0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc,"router code");
        registry=new CarveContentRegistry();
        factory=new CarveFactoryV3(registry,PLATFORM);
        root=_register("image/png",hex"89504e470d0a1a0a");
        vm.deal(address(this),100 ether);
    }
    function testToken0LaunchExternalBuySellBeforeMilestone() public { _launchAndExternalTrade(true); }
    function testToken1LaunchExternalBuySellBeforeMilestone() public { _launchAndExternalTrade(false); }
    function testAllSevenRootCombinations() public {
        for(uint256 i=1;i<8;i++) {
            CarveFactoryV3.LaunchParams memory p=_params(bytes32(i));
            p.imageRoot=i&1==0?bytes32(0):root;
            p.audioRoot=i&2==0?bytes32(0):root;
            p.websiteRoot=i&4==0?bytes32(0):root;
            (address token,address pool,)=factory.launch{value:factory.creationFee()}(p);
            require(pool!=address(0)&&CarveToken(token).imageRoot()==p.imageRoot
                &&CarveToken(token).audioRoot()==p.audioRoot&&CarveToken(token).websiteRoot()==p.websiteRoot,"roots");
        }
        require(factory.tokenCount()==7,"count");
    }
    function testAllMediaInlineOneAtomicCallPreservesCreatorAndBytes() public {
        CarveInlineContent.Asset[3] memory assets;
        assets[0]=CarveInlineContent.Asset(0,"image/png","identity",hex"89504e470d0a1a0a");
        assets[1]=CarveInlineContent.Asset(0,"audio/wav","identity",hex"524946460000000057415645");
        assets[2]=CarveInlineContent.Asset(0,"text/html","identity",bytes("<!doctype html><h1>Carve</h1>"));
        (address token,address pool,)=factory.launchWithContent{value:factory.creationFee()}(
            "Atomic","ATOM",bytes32(uint256(901)),assets,0,0,block.timestamp+60);
        require(CarveToken(token).creator()==address(this)&&pool!=address(0),"creator or pool");
        bytes32[3] memory roots=[CarveToken(token).imageRoot(),CarveToken(token).audioRoot(),CarveToken(token).websiteRoot()];
        for(uint256 i;i<3;i++) require(keccak256(registry.read(roots[i]))==keccak256(assets[i].data),"onchain exact bytes");
    }
    function testOptionalInitialBuyCreatesLockedWETHAndClearsAllowance() public {
        CarveFactoryV3.LaunchParams memory p=_buyParams(false,bytes32(uint256(33)),0.0001 ether);
        (address token,,)=factory.launch{value:factory.creationFee()+0.0001 ether}(p);
        require(CarveToken(token).balanceOf(address(this))>0,"initial buy missing");
        (,uint256 wethPrincipal,,)=factory.locker().principal(token);
        require(wethPrincipal>0&&wethPrincipal<0.0001 ether,"net locked input");
        require(ICarveERC20(CarveV3Addresses.WETH).allowance(address(factory),CarveV3Addresses.SWAP_ROUTER)==0,"router allowance");
        require(factory.pendingETH(PLATFORM)==factory.creationFee(),"fee credit");
    }
    function testMaximumInlinePayloadOneCall() public {
        CarveInlineContent.Asset[3] memory assets;
        bytes memory data=new bytes(24576);
        for(uint256 i;i<data.length;i++)data[i]=bytes1(uint8(65+(i%26)));
        assets[2]=CarveInlineContent.Asset(0,"text/html","identity",data);
        (address token,address pool,)=factory.launchWithContent{value:factory.creationFee()}(
            "Maximum inline","MAX",bytes32(uint256(902)),assets,0,0,block.timestamp+60);
        require(pool!=address(0)&&CarveToken(token).imageRoot()==0&&CarveToken(token).audioRoot()==0,"website only");
        require(keccak256(registry.read(CarveToken(token).websiteRoot()))==keccak256(data),"max inline bytes mismatch");
    }
    function testFactoryCannotSpendDonatedWETHAndInitialBuyCannotOmitProtection() public {
        ICarveWETH(CarveV3Addresses.WETH).deposit{value:1 ether}();
        require(ICarveERC20(CarveV3Addresses.WETH).transfer(address(factory),1 ether),"WETH donation");
        CarveFactoryV3.LaunchParams memory p=_buyParams(false,bytes32(uint256(903)),0.001 ether);
        factory.launch{value:factory.creationFee()+0.001 ether}(p);
        require(ICarveERC20(CarveV3Addresses.WETH).balanceOf(address(factory))==1 ether,"factory spent unrelated WETH");
        p.userSalt=bytes32(uint256(904));p.minTokensOut=0;
        vm.expectRevert(CarveFactoryV3.InvalidInitialBuy.selector);factory.launch{value:0.0006 ether}(p);
        p.minTokensOut=1;p.sqrtPriceLimitX96=0;
        factory.launch{value:0.0006 ether}(p);
        vm.expectRevert(CarveFactoryV3.InvalidInitialBuy.selector);factory.launch{value:0.0005 ether}(p);
    }
    function testDefaultRouterLimitInitialBuyBothAddressOrders() public {
        for(uint256 i;i<2;i++) {
            CarveFactoryV3.LaunchParams memory p=_orderedParams(i==0,bytes32(uint256(910+i)));
            p.minTokensOut=1000 ether;p.sqrtPriceLimitX96=0;
            (address token,,)=factory.launch{value:0.0006 ether}(p);
            require(CarveToken(token).balanceOf(address(this))>=p.minTokensOut,"default limit buy");
        }
    }
    function testInlineConcurrentWriterDoesNotRequirePredictedAddressDirection() public {
        // Simulate another user's permanent chunk between a client's preview and actual inclusion.
        registry.writeChunk(hex"f1f2f3f4");
        CarveInlineContent.Asset[3] memory assets;
        assets[2]=CarveInlineContent.Asset(0,"text/html","identity",bytes("<!doctype html><h1>Concurrent content</h1>"));
        (address token,address pool,)=factory.launchWithContent{value:0.0006 ether}(
            "Concurrent","RACE",bytes32(uint256(911)),assets,1000 ether,0,block.timestamp+60);
        require(pool!=address(0)&&CarveToken(token).balanceOf(address(this))>=1000 ether,"concurrent inline launch");
        require(keccak256(registry.read(CarveToken(token).websiteRoot()))==keccak256(assets[2].data),"wrong inline content");
        vm.expectRevert(CarveFactoryV3.InvalidInitialBuy.selector);
        factory.launchWithContent{value:0.0006 ether}(
            "No minout","ZERO",bytes32(uint256(912)),assets,0,0,block.timestamp+60);
    }
    function testPartialInitialBuyRefundPullCreditForRejectingCreator() public {
        V3RejectingCreator creator=new V3RejectingCreator();
        CarveFactoryV3.LaunchParams memory p=_params(bytes32(uint256(345)));
        address predicted=factory.predictToken(p,address(creator));
        CarveV3Math.Plan memory plan=CarveV3Math.plan(predicted,CarveV3Addresses.WETH);
        p.minTokensOut=1;
        p.sqrtPriceLimitX96=TickMath.getSqrtPriceAtTick(plan.initialTick+(plan.tokenIs0?int24(1):int24(-1)));
        (address token,,)=creator.launch{value:factory.creationFee()+1 ether}(factory,p);
        require(CarveToken(token).balanceOf(address(creator))>0,"creator bought");
        uint256 refund=factory.pendingETH(address(creator));
        require(refund>0.99 ether&&refund<1 ether,"partial refund");
        require(ICarveERC20(CarveV3Addresses.WETH).balanceOf(address(factory))==0,"unspent WETH stranded");
        uint256 before=address(this).balance;
        creator.withdraw(factory,payable(address(this)));
        require(address(this).balance==before+refund&&factory.pendingETH(address(creator))==0,"pull refund");
    }
    function testPreInitializedPredictedPoolRejectsAndNewSaltRecovers() public {
        CarveFactoryV3.LaunchParams memory p=_params(bytes32(uint256(55)));
        address predicted=factory.predictToken(p,address(this));
        address pool=ICarveV3Factory(CarveV3Addresses.FACTORY).createPool(predicted,CarveV3Addresses.WETH,10000);
        ICarveV3Pool(pool).initialize(CarveV3Math.plan(predicted,CarveV3Addresses.WETH).sqrtPriceX96);
        vm.expectRevert(CarveV3Locker.PoolAlreadyInitialized.selector);
        factory.launch{value:0.0005 ether}(p);
        require(predicted.code.length==0&&factory.tokenCount()==0&&factory.totalPendingETH()==0,"rollback failed");
        p.userSalt=bytes32(uint256(56));
        (address token,,)=factory.launch{value:factory.creationFee()}(p);
        require(token!=predicted&&factory.tokenCount()==1,"salt retry failed");
    }
    function testUninitializedPrecreatedPoolAccepted() public {
        CarveFactoryV3.LaunchParams memory p=_params(bytes32(uint256(57)));
        address predicted=factory.predictToken(p,address(this));
        address existing=ICarveV3Factory(CarveV3Addresses.FACTORY).createPool(predicted,CarveV3Addresses.WETH,10000);
        (,address pool,)=factory.launch{value:factory.creationFee()}(p);
        require(pool==existing,"uninitialized pool rejected");
    }
    function testExpiredSlippageAndMissingMediaRollback() public {
        CarveFactoryV3.LaunchParams memory p=_params(bytes32(uint256(60)));
        p.deadline=block.timestamp-1;
        vm.expectRevert(CarveFactoryV3.InvalidLaunch.selector);factory.launch{value:0.0005 ether}(p);
        p.deadline=block.timestamp+60;p.imageRoot=0;
        vm.expectRevert(CarveFactoryV3.InvalidContent.selector);factory.launch{value:0.0005 ether}(p);
        p.imageRoot=root;p.minTokensOut=type(uint256).max;
        address predicted=factory.predictToken(p,address(this));
        p.sqrtPriceLimitX96=_wideLimit(predicted);
        vm.expectRevert();factory.launch{value:0.0006 ether}(p);
        require(predicted.code.length==0&&factory.tokenCount()==0&&factory.totalPendingETH()==0,"failure left state");
    }
    function testFeeCollectionsDoNotWithdrawDustOrDonations() public {
        CarveFactoryV3.LaunchParams memory p=_buyParams(false,bytes32(uint256(65)),0.01 ether);
        (address token,,uint256 tokenId)=factory.launch{value:factory.creationFee()+0.01 ether}(p);
        uint256 sell=CarveToken(token).balanceOf(address(this))/2;
        _sell(token,sell);
        CarveV3Locker locker=factory.locker();
        ICarveWETH(CarveV3Addresses.WETH).deposit{value:1 ether}();
        require(ICarveERC20(CarveV3Addresses.WETH).transfer(address(locker),1 ether),"donate WETH");
        require(CarveToken(token).transfer(address(locker),100),"donate token");
        (,,,,,uint256 dust)=locker.positions(token);
        locker.collectFees(token);
        uint256 wethFee=locker.pendingFees(CarveV3Addresses.WETH);
        uint256 tokenFee=locker.pendingFees(token);
        require(wethFee>0&&wethFee<0.001 ether&&tokenFee>0,"fees accrued");
        vm.prank(PLATFORM);locker.withdrawFees(CarveV3Addresses.WETH,PLATFORM);
        vm.prank(PLATFORM);locker.withdrawFees(token,PLATFORM);
        require(ICarveERC20(CarveV3Addresses.WETH).balanceOf(address(locker))==1 ether,"donation stolen");
        require(CarveToken(token).balanceOf(address(locker))==dust+100,"principal dust withdrawn");
        require(ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER).ownerOf(tokenId)==address(locker),"position moved");
        vm.expectRevert(CarveV3Locker.InvalidCollection.selector);
        vm.prank(PLATFORM);locker.withdrawFees(token,PLATFORM);
    }
    function testDirectPoolAndLockerDonationsDoNotFakeMilestone() public {
        (address token,address pool,)=factory.launch{value:factory.creationFee()}(_params(bytes32(uint256(68))));
        ICarveWETH(CarveV3Addresses.WETH).deposit{value:10 ether}();
        require(ICarveERC20(CarveV3Addresses.WETH).transfer(pool,5 ether),"pool donation");
        require(ICarveERC20(CarveV3Addresses.WETH).transfer(address(factory.locker()),5 ether),"locker donation");
        (,uint256 principal,,bool milestone)=factory.locker().principal(token);
        require(principal==0&&!milestone,"donation changed principal");
        factory.locker().collectFees(token);
        require(factory.locker().pendingFees(CarveV3Addresses.WETH)==0,"donation counted as fee");
    }
    function testPermissionlessPositionIncreaseStaysLockedAndDoesNotBlockFees() public {
        (address token,,uint256 id)=factory.launch{value:factory.creationFee()}(_params(bytes32(uint256(73))));
        _buyExternal(token,0.05 ether);
        uint256 tokensToAdd=CarveToken(token).balanceOf(address(this))/2;
        ICarveWETH(CarveV3Addresses.WETH).deposit{value:1 ether}();
        require(ICarveERC20(CarveV3Addresses.WETH).approve(CarveV3Addresses.POSITION_MANAGER,1 ether),"WETH approve");
        require(CarveToken(token).approve(CarveV3Addresses.POSITION_MANAGER,tokensToAdd),"token approve");
        bool token0=token<CarveV3Addresses.WETH;
        V3IncreaseLiquidity(CarveV3Addresses.POSITION_MANAGER).increaseLiquidity(V3IncreaseLiquidity.Params(
            id,token0?tokensToAdd:1 ether,token0?1 ether:tokensToAdd,0,0,block.timestamp+60));
        factory.locker().collectFees(token);
        factory.locker().principal(token);
        require(ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER).ownerOf(id)==address(factory.locker()),"donation released NFT");
    }
    function testTradingWorksAboveAndBelowMilestoneWithoutMovingPool() public {
        (address token,address pool,)=factory.launch{value:factory.creationFee()}(_params(bytes32(uint256(75))));
        uint256 bought=_buyExternal(token,5 ether);
        (,,,bool crossed)=factory.locker().principal(token);require(crossed,"not reached");
        _sell(token,bought);
        (,,,bool stillCrossed)=factory.locker().principal(token);require(!stillCrossed,"milestone incorrectly latched");
        require(factory.poolForToken(token)==pool,"pool moved");
        _buyExternal(token,0.001 ether);
    }
    function testNoUnauthorizedPositionTransferApprovalRemovalOrFeeWithdrawal() public {
        (address token,,uint256 id)=factory.launch{value:factory.creationFee()}(_params(bytes32(uint256(80))));
        CarveV3Locker locker=factory.locker();
        vm.prank(PLATFORM);
        (bool ok,)=CarveV3Addresses.POSITION_MANAGER.call(abi.encodeWithSignature("approve(address,uint256)",PLATFORM,id));
        require(!ok,"platform approved NFT");
        vm.prank(PLATFORM);
        (ok,)=CarveV3Addresses.POSITION_MANAGER.call(abi.encodeWithSignature("transferFrom(address,address,uint256)",address(locker),PLATFORM,id));
        require(!ok,"platform moved NFT");
        vm.prank(PLATFORM);
        (ok,)=CarveV3Addresses.POSITION_MANAGER.call(abi.encodeWithSignature("decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",id,uint128(1),0,0,block.timestamp+60));
        require(!ok,"platform removed liquidity");
        vm.expectRevert(CarveV3Locker.Unauthorized.selector);locker.withdrawFees(token,address(this));
        vm.expectRevert(CarveV3Locker.Unauthorized.selector);locker.createAndLock(token,block.timestamp+60);
        require(ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER).getApproved(id)==address(0),"approval persisted");
    }
    function _launchAndExternalTrade(bool tokenIs0) private {
        CarveFactoryV3.LaunchParams memory p=_orderedParams(tokenIs0,bytes32(uint256(5)));
        (address token,address pool,uint256 id)=factory.launch{value:factory.creationFee()}(p);
        require((token<CarveV3Addresses.WETH)==tokenIs0,"ordering");
        require(ICarveV3Factory(CarveV3Addresses.FACTORY).getPool(token,CarveV3Addresses.WETH,10000)==pool,"canonical pool");
        require(CarveToken(token).totalSupply()==1e27&&CarveToken(token).creator()==address(this),"token identity");
        require(ICarveV3PositionManager(CarveV3Addresses.POSITION_MANAGER).ownerOf(id)==address(factory.locker()),"locked owner");
        uint256 amount=_buyExternal(token,0.0001 ether);
        _sell(token,amount/2);
        (,,,bool reached)=factory.locker().principal(token);require(!reached,"premature milestone");
    }
    function _params(bytes32 salt) private view returns(CarveFactoryV3.LaunchParams memory) {
        return CarveFactoryV3.LaunchParams("Carve Test","CV3",salt,root,0,0,0,0,block.timestamp+120);
    }
    function _orderedParams(bool token0,bytes32 salt) private view returns(CarveFactoryV3.LaunchParams memory p) {
        p=_params(salt);
        for(uint256 i;i<2048;i++) {
            p.userSalt=keccak256(abi.encode(salt,i));
            if((factory.predictToken(p,address(this))<CarveV3Addresses.WETH)==token0)return p;
        }
        revert("could not choose test address order");
    }
    function _buyParams(bool token0,bytes32 salt,uint256) private view returns(CarveFactoryV3.LaunchParams memory p) {
        p=_orderedParams(token0,salt);p.minTokensOut=1;p.sqrtPriceLimitX96=_wideLimit(factory.predictToken(p,address(this)));
    }
    function _wideLimit(address token) private pure returns(uint160) {
        return token<CarveV3Addresses.WETH?TickMath.MAX_SQRT_PRICE-1:TickMath.MIN_SQRT_PRICE+1;
    }
    function _buyExternal(address token,uint256 amount) private returns(uint256 output) {
        (uint256 quote,,,)=V3CoreQuoter(QUOTER).quoteExactInputSingle(V3CoreQuoter.Quote(CarveV3Addresses.WETH,token,amount,10000,0));
        ICarveWETH(CarveV3Addresses.WETH).deposit{value:amount}();
        require(ICarveERC20(CarveV3Addresses.WETH).approve(CarveV3Addresses.SWAP_ROUTER,amount),"external WETH approve");
        output=ICarveV3SwapRouter(CarveV3Addresses.SWAP_ROUTER).exactInputSingle(ICarveV3SwapRouter.ExactInputSingleParams(
            CarveV3Addresses.WETH,token,10000,address(this),amount,quote,0));
        require(output==quote&&output>0,"external buy quote mismatch");
    }
    function _sell(address token,uint256 amount) private returns(uint256 output) {
        (uint256 quote,,,)=V3CoreQuoter(QUOTER).quoteExactInputSingle(V3CoreQuoter.Quote(token,CarveV3Addresses.WETH,amount,10000,0));
        require(CarveToken(token).approve(CarveV3Addresses.SWAP_ROUTER,amount),"external token approve");
        output=ICarveV3SwapRouter(CarveV3Addresses.SWAP_ROUTER).exactInputSingle(ICarveV3SwapRouter.ExactInputSingleParams(
            token,CarveV3Addresses.WETH,10000,address(this),amount,quote,0));
        require(output==quote&&output>0,"external sell quote mismatch");
    }
    function _register(string memory mime,bytes memory data) private returns(bytes32) {
        (address pointer,bytes32 hash)=registry.writeChunk(data);
        address[] memory pointers=new address[](1);pointers[0]=pointer;
        bytes32[] memory hashes=new bytes32[](1);hashes[0]=hash;
        return registry.registerContent(mime,"identity",data.length,pointers,hashes);
    }
}
