import {parseAbi} from 'viem';

export const V3_CANONICAL={factory:'0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',manager:'0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3',router:'0xCaf681a66D020601342297493863E78C959E5cb2',weth:'0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',quoter:'0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7'} as const;
export const V3_FACTORY_ABI=parseAbi([
 'function launch((string name,string symbol,bytes32 userSalt,bytes32 imageRoot,bytes32 audioRoot,bytes32 websiteRoot,uint256 minTokensOut,uint160 sqrtPriceLimitX96,uint256 deadline) params) payable returns (address token,address pool,uint256 positionId)',
 'function launchWithContent(string name,string symbol,bytes32 userSalt,(bytes32 root,string mimeType,string encoding,bytes data)[3] assets,uint256 minTokensOut,uint160 sqrtPriceLimitX96,uint256 deadline) payable returns (address token,address pool,uint256 positionId)',
 'function registry() view returns (address)','function locker() view returns (address)','function platformRecipient() view returns (address)',
 'function creationFee() view returns (uint256)','function supply() view returns (uint256)','function poolFee() view returns (uint24)','function milestoneETH() view returns (uint256)',
 'function tokenCount() view returns (uint256)','function tokens(uint256) view returns (address)','function poolForToken(address) view returns (address)',
 'function positionIdForToken(address) view returns (uint256)','function pendingETH(address) view returns (uint256)','function withdrawETH(address recipient)',
 'event Launched(address indexed creator,address indexed token,address indexed pool,uint256 positionId,bytes32 imageRoot,bytes32 audioRoot,bytes32 websiteRoot,uint256 initialBuySpent,uint256 initialTokensOut)',
]);
export const V3_LOCKER_ABI=parseAbi([
 'function launchFactory() view returns (address)','function platformRecipient() view returns (address)',
 'function positions(address) view returns (address pool,uint256 tokenId,uint128 initialLiquidity,int24 tickLower,int24 tickUpper,uint256 tokenDust)',
 'function principal(address) view returns (uint256 tokenPrincipal,uint256 wethPrincipal,uint256 lockedDust,bool milestoneReached)',
 'function pendingFees(address) view returns (uint256)','function collectFees(address) returns (uint256 amount0,uint256 amount1)',
 'function withdrawFees(address asset,address recipient)',
]);
export const V3_POOL_ABI=parseAbi([
 'function token0() view returns (address)','function token1() view returns (address)','function factory() view returns (address)',
 'function fee() view returns (uint24)','function liquidity() view returns (uint128)',
 'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
 'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)',
 'event Initialize(uint160 sqrtPriceX96,int24 tick)',
 'event Mint(address sender,address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)',
]);
export const V3_BINDING_ABI=parseAbi(['function factory() view returns (address)','function WETH9() view returns (address)','function ownerOf(uint256) view returns (address)',
 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
 'event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)']);
export const INLINE_BYTES=24*1024;
