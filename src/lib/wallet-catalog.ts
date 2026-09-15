// Connections always use EIP-6963 announcements, never shared provider flags.
export const walletCatalog = [
 ['metamask','MetaMask','io.metamask','https://metamask.io/download'],
 ['rabby','Rabby','io.rabby','https://rabby.io'],
 ['phantom','Phantom','app.phantom','https://phantom.app/download'],
 ['zerion','Zerion','io.zerion.wallet','https://zerion.io/extension'],
 ['trust','Trust Wallet','com.trustwallet.app','https://trustwallet.com/browser-extension'],
 ['okx','OKX Wallet','com.okex.wallet','https://okx.com/download'],
 ['coinbase','Coinbase Wallet','com.coinbase.wallet','https://coinbase.com/wallet'],
 ['rainbow','Rainbow','me.rainbow','https://rainbow.me/extension'],
 ['brave','Brave Wallet','com.brave.wallet','https://brave.com/wallet/'],
 ['backpack','Backpack','app.backpack','https://backpack.app/download'],
 ['magiceden','Magic Eden','io.magiceden.wallet','https://wallet.magiceden.io/'],
 ['bitget','Bitget Wallet','com.bitget.web3','https://web3.bitget.com/en/wallet-download'],
 ['safepal','SafePal','io.safepal','https://www.safepal.com/download?product=2'],
 ['tokenpocket','TokenPocket','pro.tokenpocket','https://extension.tokenpocket.pro/'],
] as const;
export function walletBrand(rdns:string){return walletCatalog.find(row=>row[2]===(rdns==='app.backpack.mobile'?'app.backpack':rdns));}
