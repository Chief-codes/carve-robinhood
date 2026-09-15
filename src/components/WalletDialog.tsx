import * as Dialog from '@radix-ui/react-dialog';
import {ArrowUpRight,Check,Copy,LogOut,RefreshCw,Wallet,X} from 'lucide-react';
import {useState} from 'react';
import {useWallet} from '../lib/wallet';
import {walletBrand,walletCatalog} from '../lib/wallet-catalog';
import {short} from '../lib/chain';
export function WalletDialog(){
 const w=useWallet(),[open,setOpen]=useState(false),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
 const missing=walletCatalog.filter(b=>!w.providers.some(p=>walletBrand(p.info.rdns)?.[0]===b[0]));
 return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button className="wallet-button"><Wallet size={16}/>{w.address?short(w.address):'Connect wallet'}</button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{w.address?'Your wallet':'Connect a wallet'}</Dialog.Title><Dialog.Description>Choose your installed extension. Carve never asks for a private key.</Dialog.Description><Dialog.Close className="icon-button dialog-close" aria-label="Close wallet dialog"><X/></Dialog.Close>
 {w.address&&<div className="wallet-connected"><p>{w.selected?.info.name}</p><code>{w.address}</code><div className="button-row"><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(w.address!);setCopied(true);setCopyError('');setTimeout(()=>setCopied(false),1500);}catch{setCopyError('Clipboard access was denied. Select and copy the address above.');}}}>{copied?<Check size={16}/>:<Copy size={16}/>}Copy address</button><button className="secondary" disabled={w.busy} onClick={w.changeAccount}><RefreshCw size={16}/>Change account</button><button className="secondary" onClick={w.disconnect}><LogOut size={16}/>Disconnect</button></div>{w.chainId!==4663&&<button className="primary" disabled={w.busy} onClick={w.switchChain}>Switch to Robinhood Chain</button>}</div>}
 {!!w.providers.length&&<div className="wallet-list"><h3>Detected extensions</h3>{w.providers.map(p=>{const brand=walletBrand(p.info.rdns);return <button disabled={w.busy} key={p.info.uuid} onClick={()=>w.connect(p)}>{brand?<img src={'/wallets/'+brand[0]+'.webp'} alt="" width={32} height={32}/>:<Wallet/>}<span>{p.info.name}</span>{w.selected?.info.uuid===p.info.uuid?<Check size={18}/>:<ArrowUpRight size={18}/>}</button>;})}</div>}
 {!w.providers.length&&<p className="muted">No extension detected. Open this page in the browser where your wallet is installed, and allow the extension to access this site.</p>}
 {!!missing.length&&<details className="wallet-catalog"><summary>Other wallets · install or enable</summary><div className="wallet-install-grid">{missing.map(b=><a className="wallet-install" key={b[0]} href={b[3]} target="_blank" rel="noreferrer"><img src={'/wallets/'+b[0]+'.webp'} alt="" width={28} height={28} loading="lazy"/><span>{b[1]}<small>Not detected</small></span><ArrowUpRight size={14}/></a>)}</div></details>}
 <p className="muted">Only the selected extension is contacted. Disconnect ends this Carve session; revoke site permissions inside your wallet if needed. Connection support depends on the extension’s EIP-6963 support.</p>
 {(w.error||copyError)&&<p className="error" role="alert">{w.error||copyError}</p>}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
