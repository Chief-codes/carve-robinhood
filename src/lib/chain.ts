import {createPublicClient,defineChain,http,parseAbi,type Address,type Hex,isAddress,zeroHash} from 'viem';
export const NETWORK=defineChain({id:4663,name:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://rpc.mainnet.chain.robinhood.com']}},blockExplorers:{default:{name:'Blockscout',url:'https://robinhoodchain.blockscout.com'}}});
export const client=createPublicClient({chain:NETWORK,transport:http(NETWORK.rpcUrls.default.http[0],{timeout:20000,retryCount:1,batch:{batchSize:12,wait:10}}),batch:{multicall:false}});
export type Deployment={chainId:number;kind?:'curve-v4'|'v3';curveVersion?:4;status:'not-deployed'|'local'|'verified';registry:Address|null;factory:Address|null;engine:Address|null;router:Address|null;deployedBlock:string|null;launchEnabled:boolean;codeHashes?:Partial<Record<'registry'|'factory'|'engine'|'router',Hex>>;deploymentTx?:Hex;};
// Only replace using verified receipts, bytecode and immutable bindings. No query-string override.
// Replacement receipt/runtime/25 bindings verified at block 63,790,565.
// Retained registry; new factory supports every non-empty media combination.
export const LEGACY_DEPLOYMENT:Deployment={chainId:4663,kind:'curve-v4',status:'verified',registry:'0xf28e75beFA6aEeC5beDF6AD5278b12e82580985F',factory:'0x53685565c16E2BF5AaeED71D9C9456Cf8d832669',engine:'0x110128f20f99a0e7Ac69Fd3Ffc6105CcA7A16044',router:'0x868645A104aa15D0D4BbbF28F236D165d2967f81',deployedBlock:'63788317',launchEnabled:false};
// Use confirmed receipts, full runtime comparisons and immutable binding checks.
// Public source submission is a separate owner choice, not a bytecode-verification substitute.
export const V3_DEPLOYMENT:Deployment={
 chainId:4663,kind:'v3',status:'verified',registry:LEGACY_DEPLOYMENT.registry,
 factory:'0x842b508394097E0E1a359F299121C4B212c557D2',engine:'0x6579Ae79828467Cf58f7d9c9E433b6D3189eB3E0',
 router:'0xCaf681a66D020601342297493863E78C959E5cb2',deployedBlock:'63832353',launchEnabled:true,
 deploymentTx:'0x4705110b3b0ffa5e604f26f712526a158161334e7d3d21be9ea14c443ec461c0',
 codeHashes:{
  registry:'0x9b78648a676fced6841980d9dd3fe04eb1c863d2006ad06203ec0a04770eba90',
  factory:'0x8398dc7ace5f60e192b4ad82f5c08e9280c756e868034e88e06d0b1f1046e8ff',
  engine:'0xd9ec2c85f431a4597e0f43d49b51462078cf9e19bd2a669ed580d423fe5e953c',
  router:'0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc'
 }
};
// No predicted addresses: enabled only after the user's replacement receipt and bindings are verified.
export const CURVE_DEPLOYMENT:Deployment={
  "chainId": 4663,
  "kind": "curve-v4",
  "curveVersion": 4,
  "status": "verified",
  "registry": "0xf28e75beFA6aEeC5beDF6AD5278b12e82580985F",
  "factory": "0xf843A997447E3eF9cf44a9078BBe870E7ef3F67c",
  "engine": "0x91A6877c72B82e0E7AE0F0488EbD8356Ff5EE044",
  "router": "0x9D854151c1db6218B7C9e1f48E9E553cdCDd2D53",
  "deployedBlock": "63884617",
  "launchEnabled": true,
  "codeHashes": {
    "registry": "0x9b78648a676fced6841980d9dd3fe04eb1c863d2006ad06203ec0a04770eba90",
    "factory": "0x7f259a29a5161b893e38e12dff76287c125b55561564f936a264799ea582198a",
    "engine": "0x5bf79fda479700a5543d95f13a9100ad8c42597a072d88f660b24b6032d48b3c",
    "router": "0x203c3b03ff4891d79ceb83cf9470b81344213efa747518ba2139952ca5fa3638"
  },
  "deploymentTx": "0x8c6a5d317d3426ea17d70a7c2bb3001f3d08e87e94be765b4c1d55b7d73baa03"
};
export const DEPLOYMENT:Deployment=CURVE_DEPLOYMENT.status==='verified'?CURVE_DEPLOYMENT:V3_DEPLOYMENT.status==='verified'?V3_DEPLOYMENT:LEGACY_DEPLOYMENT;
export const REGISTRY_ABI=parseAbi([
 'function writeChunk(bytes data) returns (address pointer,bytes32 chunkHash)',
 'function pointerForHash(bytes32) view returns (address)',
 'function registerContent(string mimeType,string encoding,uint256 byteLength,address[] pointers,bytes32[] chunkHashes) returns (bytes32 root)',
 'function exists(bytes32 root) view returns (bool)',
 'function getContent(bytes32 root) view returns (uint8 version,string mimeType,string encoding,uint256 byteLength,address creator,address[] pointers,bytes32[] chunkHashes)',
 'function readChunk(address pointer) view returns (bytes data)',
 'event ChunkWritten(address indexed pointer,bytes32 indexed chunkHash,uint256 byteLength)',
 'event ContentRegistered(bytes32 indexed root,address indexed creator,string mimeType,string encoding,uint256 byteLength)'
]);
export const FACTORY_ABI=parseAbi([
 'function launch(string name,string symbol,bytes32 imageRoot,bytes32 audioRoot,bytes32 websiteRoot,uint16 creatorFeeBps,uint256 minTokensOut,uint256 deadline) payable returns (address token,address market)',
 'function creationFee() view returns (uint256)', 'function platformRecipient() view returns (address)',
 'function registry() view returns (address)', 'function migrationAdapter() view returns (address)',
 'function supply() view returns (uint256)', 'function virtualETH() view returns (uint256)', 'function capETH() view returns (uint256)',
 'function creatorFeeLimitBps() view returns (uint16)', 'function marketCount() view returns (uint256)',
 'function markets(uint256) view returns (address)', 'function marketForToken(address) view returns (address)',
 'event Launched(address indexed creator,address indexed token,address indexed market,bytes32 imageRoot,bytes32 audioRoot,bytes32 websiteRoot,uint16 creatorFeeBps)'
]);
export const TOKEN_ABI=parseAbi(['function name() view returns (string)','function symbol() view returns (string)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)','function creator() view returns (address)','function contentRegistry() view returns (address)','function imageRoot() view returns (bytes32)','function audioRoot() view returns (bytes32)','function websiteRoot() view returns (bytes32)']);
export const MARKET_ABI=parseAbi([
 'function token() view returns (address)','function creator() view returns (address)','function creatorFeeBps() view returns (uint16)',
 'function phase() view returns (uint8)','function reserveETH() view returns (uint256)','function inventory() view returns (uint256)',
 'function quoteBuy(uint256 grossETH) view returns (uint256 tokensOut,uint256 acceptedGross,uint256 platformFee,uint256 creatorFee,uint256 refund)',
 'function quoteSell(uint256 tokensIn) view returns (uint256 ethOut,uint256 platformFee,uint256 creatorFee)',
 'function buy(uint256 minTokensOut,uint256 deadline) payable returns (uint256 tokensOut)',
 'function sell(uint256 tokensIn,uint256 minETHOut,uint256 deadline) returns (uint256 ethOut)',
 'function pendingETH(address) view returns (uint256)','function withdrawETH(address recipient)',
 'function graduate(uint128 minLiquidity,uint256 deadline) returns ((bytes32 poolId,uint128 liquidity,uint256 ethSpent,uint256 tokensSpent,uint256 lockedETH,uint256 lockedTokens))',
 'function graduationReceipt() view returns ((bytes32 poolId,uint128 liquidity,uint256 ethSpent,uint256 tokensSpent,uint256 lockedETH,uint256 lockedTokens))'
]);
export const ENGINE_ABI=parseAbi(['function factory() view returns (address)','function poolManager() view returns (address)','function feeCredit(address,address) view returns (uint256)','function withdrawFees(address asset,address recipient)']);
export const ROUTER_ABI=parseAbi([
 'function engine() view returns (address)','function poolManager() view returns (address)',
 'function swapExactInput(address token,bool buy,uint256 amountIn,uint256 minOut,uint160 priceLimit,uint256 deadline) payable returns (uint256 input,uint256 output)',
 'function pendingETH(address) view returns (uint256)','function withdrawETH(address recipient)'
]);
export function short(value:string,n=6){return `${value.slice(0,n)}…${value.slice(-4)}`;}
export async function inspectToken(address:string){
 if(!isAddress(address))throw new Error('Enter a valid 0x token contract address.');
 const code=await client.getCode({address});if(!code||code==='0x')throw new Error('No contract exists at this address on Robinhood Chain.');
 const [name,symbol,supply]=await Promise.all(['name','symbol','totalSupply'].map(functionName=>client.readContract({address,abi:TOKEN_ABI,functionName:functionName as 'name'})));
 const roots=await Promise.all(['imageRoot','audioRoot','websiteRoot'].map(functionName=>client.readContract({address,abi:TOKEN_ABI,functionName:functionName as 'imageRoot'}).catch(()=>null)));
 const registry=await client.readContract({address,abi:TOKEN_ABI,functionName:'contentRegistry'}).catch(()=>null);
 return {address,name:String(name),symbol:String(symbol),supply:String(supply),registry,roots:roots as (Hex|null)[],inscribed:roots.some(r=>!!r&&r!==zeroHash)};
}
export async function verifiedChain(){const id=await client.getChainId();if(id!==4663)throw new Error('The RPC returned the wrong chain.');return {block:await client.getBlockNumber(),gasPrice:await client.getGasPrice()};}
