// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {CarveCurveFactory} from "../src/curve/CarveCurveFactory.sol";
import {CarveCurveMarket} from "../src/curve/CarveCurveMarket.sol";
import {CarveCurveEngine} from "../src/curve/CarveCurveEngine.sol";
import {CarveCurveRouter} from "../src/curve/CarveCurveRouter.sol";
import {CarveContentRegistry} from "../src/CarveContentRegistry.sol";
import {CarveToken} from "../src/CarveToken.sol";
import {CarveInlineContent} from "../src/v3/CarveInlineContent.sol";
interface DeployedVm { function deal(address,uint256) external; function skip(bool) external; }
/// Tests the actual deployed factory on a read-only mainnet fork, not a newly substituted factory.
contract CarveCurveDeployedForkTest {
 DeployedVm constant vm=DeployedVm(address(uint160(uint256(keccak256("hevm cheat code")))));
 CarveCurveFactory constant factory=CarveCurveFactory(0xf843A997447E3eF9cf44a9078BBe870E7ef3F67c);
 CarveCurveEngine constant engine=CarveCurveEngine(payable(0x91A6877c72B82e0E7AE0F0488EbD8356Ff5EE044));
 CarveCurveRouter constant router=CarveCurveRouter(payable(0x9D854151c1db6218B7C9e1f48E9E553cdCDd2D53));
 CarveToken token; CarveCurveMarket market;
 receive() external payable {}
 function setUp() public {
  vm.skip(address(factory).code.length==0);
  require(block.chainid==4663,"wrong fork");
  vm.deal(address(this),100 ether);
  require(factory.version()==4 && factory.locker()==address(engine),"wrong deployment");
 }
 function assets() private pure returns(CarveInlineContent.Asset[3] memory a) {
  a[0]=CarveInlineContent.Asset(0,"image/png","identity",hex"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082");
  a[1]=CarveInlineContent.Asset(0,"audio/wav","identity",hex"524946462600000057415645666d74201000000001000100401f0000401f00000100080064617461020000008080");
  a[2]=CarveInlineContent.Asset(0,"text/html","identity",bytes("<!doctype html><title>Carve fork proof</title><h1>Stored onchain</h1>"));
 }
 function launch(uint256 buy,uint16 fee) private {
  (address t,address m)=factory.launchInline{value:0.0005 ether+buy}("Carve deployed proof","CVPROOF",assets(),fee,0,block.timestamp+600);
  token=CarveToken(t);market=CarveCurveMarket(payable(m));
 }
 function testDeployedAllMediaImageEqualsUploadedBytes() public {
  launch(0.01 ether,0);CarveInlineContent.Asset[3] memory a=assets();
  CarveContentRegistry registry=CarveContentRegistry(token.contentRegistry());
  require(token.creator()==address(this)&&factory.marketForToken(address(token))==address(market),"creator binding");
  require(keccak256(registry.read(token.imageRoot()))==keccak256(a[0].data),"token artwork mismatch");
  require(keccak256(registry.read(token.audioRoot()))==keccak256(a[1].data),"audio mismatch");
  require(keccak256(registry.read(token.websiteRoot()))==keccak256(a[2].data),"website mismatch");
  require(market.reserveETH()==0.0099 ether&&token.balanceOf(address(this))==uint256(1e27)*99/16899,"0.01 buy ratio");
 }
 function testDeployedZeroBuyAndAllSevenCombinations() public {
  for(uint8 mask=1;mask<8;mask++){
   CarveInlineContent.Asset[3] memory a=assets();
   for(uint8 i;i<3;i++)if((mask&(1<<i))==0)delete a[i];
   (address t,address m)=factory.launchInline{value:0.0005 ether}("Combination","MEDIA",a,1000,0,block.timestamp);
   require(CarveToken(t).balanceOf(address(this))==0&&CarveCurveMarket(payable(m)).reserveETH()==0,"zero buy");
   require((CarveToken(t).imageRoot()!=0)==((mask&1)!=0),"image presence");
  }
 }
 function testDeployedFeesAndNativeCurveSell() public {
  launch(0.01 ether,200);uint256 qty=token.balanceOf(address(this))/2;
  require(market.reserveETH()==0.0097 ether,"3% total fees");
  (uint256 expected,,)=market.quoteSell(qty);token.approve(address(market),qty);
  uint256 balance=address(this).balance;market.sell(qty,expected,block.timestamp);
  require(address(this).balance==balance+expected,"native ETH not received");
 }
 function testDeployedCapMigrationAndPostMigrationTrade() public {
  launch(0.01 ether,0);market.buy{value:5 ether}(1,block.timestamp);
  require(uint8(market.phase())==2&&engine.verifyPosition(address(market)),"migration failed");
  uint256 nft=engine.positionForMarket(address(market));require(nft>0,"NFPM NFT missing");
  (,uint256 bought)=router.swapExactInput{value:0.01 ether}(address(token),true,0.01 ether,1,0,block.timestamp);
  token.approve(address(router),bought/2);uint256 balance=address(this).balance;
  (,uint256 got)=router.swapExactInput(address(token),false,bought/2,1,0,block.timestamp);
  require(got>0&&address(this).balance==balance+got,"post migration sell not paid");
 }
}
