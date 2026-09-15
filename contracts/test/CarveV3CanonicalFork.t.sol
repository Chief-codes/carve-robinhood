// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface V3ForkVm { function deal(address,uint256) external; function skip(bool) external; }
interface V3FixtureERC20 { function balanceOf(address) external view returns(uint256); function approve(address,uint256) external returns(bool); }
interface V3FixtureFactory { function getPool(address,address,uint24) external view returns(address); function feeAmountTickSpacing(uint24) external view returns(int24); }
interface V3FixturePool { function liquidity() external view returns(uint128); function slot0() external view returns(uint160,int24,uint16,uint16,uint16,uint8,bool); }
interface V3FixturePositionManager { function factory() external view returns(address); function WETH9() external view returns(address); function ownerOf(uint256) external view returns(address); }
interface V3FixtureRouter {
    struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }
    struct ExactOutputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountOut; uint256 amountInMaximum; uint160 sqrtPriceLimitX96; }
    function factory() external view returns(address);
    function factoryV2() external view returns(address);
    function WETH9() external view returns(address);
    function positionManager() external view returns(address);
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns(uint256);
    function exactOutputSingle(ExactOutputSingleParams calldata) external payable returns(uint256);
    function refundETH() external payable;
}
interface V3FixtureQuoter {
    struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }
    struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount; uint24 fee; uint160 sqrtPriceLimitX96; }
    function factory() external view returns(address);
    function WETH9() external view returns(address);
    function quoteExactInputSingle(QuoteExactInputSingleParams memory) external returns(uint256,uint160,uint32,uint256);
    function quoteExactOutputSingle(QuoteExactOutputSingleParams memory) external returns(uint256,uint160,uint32,uint256);
}

/// @notice Genuine fork-only infrastructure fixture. Never etches or mocks canonical contracts.
/// @dev Run with --fork-url https://rpc.mainnet.chain.robinhood.com --fork-block-number <fresh fixed block>.
///      Synthetic funds and all test swaps exist only inside Foundry's local EVM; no broadcast path exists.
contract CarveV3CanonicalForkTest {
    V3ForkVm constant vm=V3ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant FACTORY=0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant POSITION_MANAGER=0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant ROUTER=0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER=0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address constant WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant TOKEN=0x055650555Be80649397084Cd3f8a09b4350e8612;
    address constant POOL=0x8f4F723f10fc7bAD28742d25c91158C728557C4c;
    address constant LOCKER=0x736D76699C26D0d966744cAe304C000d471f7F35;
    receive() external payable {}

    function setUp() public {
        vm.skip(FACTORY.code.length==0);
        require(block.chainid==4663,"not Robinhood fork");
        require(FACTORY.codehash==0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739,"factory code drift");
        require(POSITION_MANAGER.codehash==0x0a493d1af3d0f25fed8efa205244ebee14114267a08647fc38c515c7cd6ead4f,"manager code drift");
        require(ROUTER.codehash==0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc,"router code drift");
        require(QUOTER.codehash==0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28,"quoter code drift");
        vm.deal(address(this),1 ether);
    }

    function testCanonicalBindingsAndExistingLockedPosition() public view {
        require(V3FixtureFactory(FACTORY).getPool(TOKEN,WETH,10000)==POOL,"pool binding");
        require(V3FixtureFactory(FACTORY).feeAmountTickSpacing(10000)==200,"fee/tick");
        require(V3FixtureFactory(FACTORY).feeAmountTickSpacing(20000)==0,"2% unexpectedly enabled");
        require(V3FixtureFactory(FACTORY).feeAmountTickSpacing(110000)==0,"11% unexpectedly enabled");
        require(V3FixturePositionManager(POSITION_MANAGER).factory()==FACTORY,"nft factory");
        require(V3FixturePositionManager(POSITION_MANAGER).WETH9()==WETH,"nft WETH");
        require(V3FixtureRouter(ROUTER).factory()==FACTORY,"router factory");
        require(V3FixtureRouter(ROUTER).WETH9()==WETH,"router WETH");
        require(V3FixtureRouter(ROUTER).positionManager()==POSITION_MANAGER,"router nft");
        require(V3FixtureQuoter(QUOTER).factory()==FACTORY,"quoter factory");
        require(V3FixtureQuoter(QUOTER).WETH9()==WETH,"quoter WETH");
        _assertLocked();
    }

    function testQuoterBothDirectionsDoesNotChangePool() public {
        bytes32 beforeState=_stateHash();
        require(_quoteIn(WETH,TOKEN,0.0001 ether)>0,"buy quote");
        require(_quoteIn(TOKEN,WETH,1 ether)>0,"sell quote");
        require(_quoteOut(WETH,TOKEN,1000 ether)>0,"exactout buy quote");
        require(_quoteOut(TOKEN,WETH,0.00000001 ether)>0,"exactout sell quote");
        require(_stateHash()==beforeState,"quoter mutated pool");
        require(V3FixtureERC20(TOKEN).balanceOf(address(this))==0,"quote transferred token");
    }

    function testRealRouterExactInputBuyAndSellMatchesQuoter() public {
        uint128 beforeLiquidity=V3FixturePool(POOL).liquidity();
        uint256 quoted=_quoteIn(WETH,TOKEN,0.0001 ether);
        uint256 bought=V3FixtureRouter(ROUTER).exactInputSingle{value:0.0001 ether}(
            V3FixtureRouter.ExactInputSingleParams(WETH,TOKEN,10000,address(this),0.0001 ether,quoted,0));
        require(bought==quoted&&V3FixtureERC20(TOKEN).balanceOf(address(this))==bought,"buy quote/output");
        uint256 sellAmount=bought/2;
        uint256 sellQuote=_quoteIn(TOKEN,WETH,sellAmount);
        require(V3FixtureERC20(TOKEN).approve(ROUTER,sellAmount),"approval");
        uint256 sold=V3FixtureRouter(ROUTER).exactInputSingle(
            V3FixtureRouter.ExactInputSingleParams(TOKEN,WETH,10000,address(this),sellAmount,sellQuote,0));
        require(sold==sellQuote&&V3FixtureERC20(WETH).balanceOf(address(this))==sold,"sell quote/output");
        require(V3FixturePool(POOL).liquidity()==beforeLiquidity,"locked liquidity changed");
        _assertLocked();
    }

    function testRealRouterExactOutputBuyAndSellMatchesQuoter() public {
        uint128 beforeLiquidity=V3FixturePool(POOL).liquidity();
        uint256 bought=1000 ether;
        uint256 quote=_quoteOut(WETH,TOKEN,bought);
        uint256 spent=V3FixtureRouter(ROUTER).exactOutputSingle{value:quote}(
            V3FixtureRouter.ExactOutputSingleParams(WETH,TOKEN,10000,address(this),bought,quote,0));
        require(spent==quote&&V3FixtureERC20(TOKEN).balanceOf(address(this))==bought,"exactout buy");
        uint256 desired=0.00000001 ether;
        uint256 sellQuote=_quoteOut(TOKEN,WETH,desired);
        require(sellQuote<bought,"fixture too small");
        require(V3FixtureERC20(TOKEN).approve(ROUTER,sellQuote),"approval");
        uint256 tokensSpent=V3FixtureRouter(ROUTER).exactOutputSingle(
            V3FixtureRouter.ExactOutputSingleParams(TOKEN,WETH,10000,address(this),desired,sellQuote,0));
        require(tokensSpent==sellQuote&&V3FixtureERC20(WETH).balanceOf(address(this))==desired,"exactout sell");
        require(V3FixturePool(POOL).liquidity()==beforeLiquidity,"locked liquidity changed");
        _assertLocked();
    }

    function testSlippageRevertLeavesPoolUnchanged() public {
        bytes32 beforeState=_stateHash();
        uint256 quoted=_quoteIn(WETH,TOKEN,0.0001 ether);
        (bool ok,)=ROUTER.call{value:0.0001 ether}(abi.encodeCall(V3FixtureRouter.exactInputSingle,
            (V3FixtureRouter.ExactInputSingleParams(WETH,TOKEN,10000,address(this),0.0001 ether,quoted+1,0))));
        require(!ok,"slippage accepted");
        require(_stateHash()==beforeState,"failed swap mutated pool");
        require(V3FixtureERC20(TOKEN).balanceOf(address(this))==0,"failed swap token");
    }

    function _quoteIn(address tokenIn,address tokenOut,uint256 amount) private returns(uint256 output) {
        (output,,,)=V3FixtureQuoter(QUOTER).quoteExactInputSingle(V3FixtureQuoter.QuoteExactInputSingleParams(tokenIn,tokenOut,amount,10000,0));
    }
    function _quoteOut(address tokenIn,address tokenOut,uint256 amount) private returns(uint256 input) {
        (input,,,)=V3FixtureQuoter(QUOTER).quoteExactOutputSingle(V3FixtureQuoter.QuoteExactOutputSingleParams(tokenIn,tokenOut,amount,10000,0));
    }
    function _assertLocked() private view {
        require(V3FixturePositionManager(POSITION_MANAGER).ownerOf(109858)==LOCKER,"position owner");
        require(V3FixturePool(POOL).liquidity()>0,"no liquidity");
    }
    function _stateHash() private view returns(bytes32) {
        (bool ok,bytes memory data)=POOL.staticcall(abi.encodeCall(V3FixturePool.slot0,()));require(ok,"slot0");
        return keccak256(abi.encode(data,V3FixturePool(POOL).liquidity(),V3FixtureERC20(TOKEN).balanceOf(POOL),V3FixtureERC20(WETH).balanceOf(POOL)));
    }
}
