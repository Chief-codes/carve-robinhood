import {parseAbi} from 'viem';
import {FACTORY_ABI} from './chain';
export const CURVE_FACTORY_ABI=[...FACTORY_ABI,...parseAbi([
 'function version() view returns (uint256)',
 'function maxInlineBytes() view returns (uint256)',
 'function launchInline(string name,string symbol,(bytes32 root,string mimeType,string encoding,bytes data)[3] assets,uint16 creatorFeeBps,uint256 minTokensOut,uint256 deadline) payable returns (address token,address market)',
])];
export const CURVE_ENGINE_ABI=parseAbi([
 'function POSITION_MANAGER() view returns (address)',
 'function POSITION_MANAGER_CODE_HASH() view returns (bytes32)',
 'function PERMIT2() view returns (address)',
 'function positionForMarket(address market) view returns (uint256)',
 'function verifyPosition(address market) view returns (bool)',
]);
export const CURVE_POSITION_MANAGER='0x58daec3116aae6D93017bAAea7749052E8a04fA7' as const;
export const CURVE_POSITION_MANAGER_HASH='0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2' as const;
