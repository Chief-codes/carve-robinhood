import type {ReactNode} from 'react';
import {BookOpen,ArrowUpRight,Download,ShieldCheck} from 'lucide-react';
import {DEPLOYMENT} from '../lib/chain';
const scan='https://robinhoodchain.blockscout.com';
function Guide({title,children,open=false}:{title:string;children:ReactNode;open?:boolean}){
 return <details open={open}><summary>{title}</summary>{children}</details>;
}
export function DocsPage(){return <>
 <div className="page-heading compact"><div><div className="eyebrow">THE SIMPLE GUIDE</div><h1>Carve, <em>step by step.</em></h1><p>Launch a token. Keep its media onchain. Check it yourself.</p></div><BookOpen size={32}/></div>
 <div className="docs-grid"><article className="panel prose verification-docs">
 <h2>What can you do with Carve?</h2>
 <p>Launch a token on Robinhood Chain with an image or GIF, sound, a website—or all three. The prepared files are stored directly onchain, not just linked to a file host. You can also trade Carve tokens and check their stored media.</p>
 <p>Open a topic below. You do not need a wallet just to browse or verify.</p>

 <Guide title="1. Create and launch a token" open>
 <ol>
  <li>Open <a href="#/studio">Create</a>. Add your token name and ticker.</li>
  <li>Upload at least one file: image/GIF, sound or a self-contained HTML website. You can use any combination of the three slots.</li>
  <li>Check the prepared previews. Choose your creator fee, optional initial buy and optional buyback &amp; burn.</li>
  <li>Click <strong>Review inscription</strong>. Check the files, total costs and wallet, then approve the upload and launch requests in your wallet.</li>
  <li>After confirmation, save your token’s contract address (CA). Open its token page to trade or choose <strong>Verify inscription</strong>.</li>
 </ol>
 <p><strong>Important:</strong> launching costs 0.0005 ETH, plus storage/transaction gas and any initial buy you choose. Small files totalling up to 24 KiB can launch in one approval. Larger files need several uploads. The review shows the expected requests.</p>
 <p>The description field stays in your draft; it is not automatically inscribed. Put any text you want stored permanently inside your website file. Published media and launch settings cannot be edited or deleted.</p>
 </Guide>

 <Guide title="2. Add images, GIFs, sound and websites">
 <ul>
  <li><strong>Image or GIF:</strong> upload PNG, JPG, WebP or GIF. A still image and a GIF share one slot, so choose one of them.</li>
  <li><strong>GIF compression:</strong> Carve reduces the file locally while keeping its animation timing. Check the prepared result before launch. Prepared GIFs must fit within 1 MB; unsuitable files are rejected before you approve anything.</li>
  <li><strong>Sound:</strong> upload supported audio or record up to five seconds. Use the play button to check it.</li>
  <li><strong>Website:</strong> upload self-contained HTML or use “Write HTML instead.” Include images and other resources inside the file; external links to resources may not work in the isolated preview.</li>
 </ul>
 <p>Each prepared file is limited to 1 MB. More data means more storage gas. The prepared files—not necessarily your original uncompressed files—are what get stored onchain.</p>
 <p><strong>GIF demo:</strong> the jumping Carve Buddy is a transparent website example. It is <strong>not automatically included</strong> in your token or charged as storage. Upload your own file to inscribe it. Reduced-motion visitors see a still version of the example.</p>
 </Guide>

 <Guide title="3. Connect, change or disconnect a wallet">
 <ol><li>Click <strong>Connect wallet</strong> and select your installed extension.</li><li>Choose the account you want. If asked, switch to <strong>Robinhood Chain</strong>.</li><li>Click your wallet address again to use <strong>Change account</strong>, select another detected extension or <strong>Disconnect</strong>.</li></ol>
 <p>If no extension appears, open Carve in the browser where it is installed and allow it access to this website. “Other wallets” provides installation links; it does not mean every extension is already connected.</p>
 <p>Disconnect ends your Carve session. To remove the site’s permission completely, use your wallet’s connected-sites settings. Carve never needs your private key or seed phrase.</p>
 </Guide>

 <Guide title="4. Explore tokens and understand their figures">
 <p>Open <a href="#/explore">Explore</a> to see Carve launches, or paste a Robinhood token CA into <strong>Inspect a token</strong>.</p>
 <ul><li>Search and filter launches by their stage, media and creator fee.</li><li>Sort by newest, market cap, volume, curve progress and the other listed options.</li><li>Use <strong>Live updates</strong> or <strong>Refresh</strong> to get newer readings.</li></ul>
 <p><strong>Market cap / FDV</strong> means total supply multiplied by the current token price. It is not cash in the pool or what everyone could sell for. <strong>Volume</strong> is trading activity. <strong>Curve progress</strong> is progress toward 4.2 ETH of real reserves. Feed figures are shown in ETH.</p>
 <p>Figures are snapshots and can change. An unavailable figure is not zero. A token without a Carve record cannot be verified as a Carve inscription.</p>
 </Guide>

 <Guide title="5. Buy, sell and follow the bonding curve">
 <ol><li>Open the token page in Explore and connect your wallet.</li><li>Choose <strong>Buy</strong> or <strong>Sell</strong>, enter an amount and check the wallet balance.</li><li>Use <strong>Preview swap</strong> or <strong>Refresh live quote</strong>. Check fees, expected output, slippage and gas.</li><li>Approve only the trade you reviewed. Selling may first require a token-spending approval.</li></ol>
 <p><strong>Slippage</strong> is how much worse a price you will accept if it changes before your trade completes. Raising it can make a trade cost more. Quotes expire after 60 seconds; refresh an old quote.</p>
 <p>Each new launch starts with 1 billion tokens. The curve’s 1.68 ETH <strong>virtual reserve</strong> is a pricing number—not deposited ETH. Buys add real reserves after fees; sells reduce them.</p>
 <p>At 4.2 ETH of real reserves, the contract attempts automatic migration to a Uniswap V4 pool with permanently locked liquidity. If it cannot finish, the token page offers <strong>Complete migration</strong> to retry. Until it succeeds, the page must not call the token migrated.</p>
 <p>Sales and unused buy amounts normally return to your wallet. If your receiving wallet rejects ETH, the amount stays as a withdrawable credit. Other trading websites decide which tokens and pools they support; instant listings are not guaranteed.</p>
 </Guide>

 <Guide title="6. Fees, creator revenue and automatic buyback">
 <p>Trading fees are <strong>1% for Carve</strong>, plus the creator’s chosen <strong>0–10%</strong>. The creator chooses this when launching; it cannot be changed afterward.</p>
 <p>With <strong>Automatic buyback &amp; burn</strong> on, the creator’s part is split:</p>
 <ul><li><strong>20%</strong> remains creator revenue.</li><li><strong>80%</strong> goes toward buying and removing that same token from circulation.</li></ul>
 <p><strong>Example:</strong> choose a 1% creator fee. Total trading fee is 2%: 1% Carve, 0.2% creator revenue and 0.8% buyback budget.</p>
 <p>Successful trades trigger eligible buybacks—there is no schedule or extra signature each time. No trades means no processing. Small amounts accumulate first; a failed internal attempt keeps its budget for a later trade. The token page shows pending funds and completed activity.</p>
 <p>Tokens are sent to the dead address. They leave circulation, but the displayed total supply does not decrease. Buyback does not guarantee a rising price. Carve cannot spend the creator’s personal wallet.</p>
 <p>Connect the fee-recipient wallet and use <strong>Withdraw</strong> on the token page when a credit is available. Ordinary trading and withdrawal gas still apply. Older tokens do not gain buyback automatically.</p>
 <details><summary>Buyback limits</summary><p>Minimum ETH budget: 0.00001 ETH. Each purchase is bounded by 0.002 ETH and 0.1% of virtual native reserves, with price limits. Eligible trades use extra gas. After migration, the buyback share of token-denominated fees goes directly to the dead address. Counter reads may be unavailable; unavailable is never shown as a fabricated balance.</p></details>
 </Guide>

 <Guide title="7. Verify the image, GIF, sound or website">
 <ol><li>Open a token in <a href="#/explore">Explore</a>.</li><li>Click <strong>Verify inscription</strong>. No wallet is needed.</li><li>Carve retrieves the stored data, checks it, then lets you view, play or download the reconstructed files.</li><li>Download the proof if you want to keep the verification details.</li></ol>
 <p><strong>Copy media data URL</strong> copies the verified file into a self-contained browser URL. If the URL is too long for your browser, download the file instead. Use the isolated preview for unknown websites.</p>
 <p>A missing sound or website is normal if its creator did not include it. Verification proves the stored bytes match the token’s record—not that its claims are true, that its files are safe or that it is a good investment.</p>
 <p>You can also keep a standalone verifier. It needs internet access to Robinhood’s public RPC, but no Carve account, backend or wallet.</p>
 <a className="secondary" href="/carve-verifier.html" download><Download size={16}/>Download independent verifier</a>
 </Guide>

 <Guide title="8. Use Musebook and agent capsules">
 <p><a href="#/agents">Musebook</a> shows real public conversations. It refreshes about every 15 seconds while the tab is visible. Network delays or the source going offline can delay updates.</p>
 <ol><li>Choose a public Musebook identity and channel.</li><li>Select up to eight posts and review the exact text you want to preserve.</li><li>Continue to Create. The snapshot becomes an HTML file in your website slot.</li><li>Add an image/GIF or sound if you want, then review and launch normally.</li></ol>
 <p>You can also write your own public profile or blueprint. If you already have a website in the draft, review the option to keep its original file as an attachment inside the capsule.</p>
 <p><strong>A capsule is a saved snapshot, not a running AI agent.</strong> It cannot chat, trade, update itself or post to Musebook. Carve does not create Musebook residents, claim ownership of them or imply endorsement.</p>
 <p>After launch, Verify inscription can recover the snapshot and its configuration. Only preserve content you have permission to publish. Preparing a snapshot does not put it onchain until you approve the launch.</p>
 </Guide>

 <Guide title="9. Save, export, import or resume your work">
 <p><a href="#/library">My workspace</a> shows your local draft, connected wallet balance and launches made by that wallet.</p>
 <ul><li><strong>Continue editing:</strong> return to Create.</li><li><strong>Export:</strong> save a draft backup to your device.</li><li><strong>Import a Carve draft:</strong> restore an exported draft.</li></ul>
 <p>Drafts stay in this browser. Export before clearing browser data or changing devices. If an upload is interrupted, keep the same browser draft and wallet so confirmed uploads can be reused. Do not repeat a launch while its transaction is still pending.</p>
 <details><summary>Moving from the old website address</summary><p>Saved drafts and wallet permissions do not automatically move between domains. Open <a href="https://carve-robinhood.netlify.app/#/library" target="_blank" rel="noopener noreferrer">My workspace at the old address</a>, export your draft, then import it at carvelaunch.com. Keep the original backup. If uploads or a wallet transaction are still in progress, resume on the original address first. Reconnect through your wallet extension on the new domain.</p></details>
 </Guide>

 <Guide title="10. Troubleshooting">
 <ul>
  <li><strong>No wallet detected:</strong> enable your wallet extension on this site and refresh.</li>
  <li><strong>File rejected:</strong> use the supported format and a smaller file. Websites should include their resources inside the HTML.</li>
  <li><strong>No sound:</strong> press play. Browsers may block audio until you interact.</li>
  <li><strong>Quote or balance unavailable:</strong> check the network, then refresh. Do not interpret a failed read as zero.</li>
  <li><strong>A wallet request was rejected:</strong> check wallet Activity before retrying. Rejection is different from a submitted transaction.</li>
  <li><strong>The new domain does not open yet:</strong> DNS caches may still be updating. The original Netlify address remains available.</li>
 </ul>
 <p>Never share seed phrases or private keys. Review wallet requests carefully: published files are permanent and confirmed gas cannot be refunded.</p>
 </Guide>

 <Guide title="Advanced: check the explorer and contract source">
 <p>Carve’s <a href="https://github.com/Chief-codes/carve-robinhood" target="_blank" rel="noreferrer">public GitHub repository</a> contains its code. Source verification and media verification are different: one checks contract code; the other checks the actual inscribed files.</p>
 <ol><li>On the token’s explorer page, open <strong>Contract → Read contract</strong>. Read <code>contentRegistry()</code>, <code>imageRoot()</code>, <code>audioRoot()</code> and <code>websiteRoot()</code>. A zero root means that media is absent.</li><li>At the registry, call <code>getContent(bytes32)</code> with a nonzero root. It gives the file type, encoding, length, ordered pointers and hashes.</li><li>Use <code>read(bytes32)</code>, or <code>readChunk(address)</code> for each pointer in order. For raw bytecode only, remove its first <code>00</code> byte; <code>readChunk</code> already removes it.</li><li>Join the chunks, check the Keccak-256 hashes and encoded length, then decompress if the record says <code>gzip</code>.</li></ol>
 <p>The content root is <code>keccak256(abi.encode(uint8(1), mimeType, encoding, encodedByteLength, orderedPointers, orderedChunkHashes))</code>, using types <code>uint8,string,string,uint256,address[],bytes32[]</code>. The standalone verifier performs these checks for you.</p>
 <p>Explorer Read panels depend on ABI indexing. The token does not currently have a <code>tokenURI()</code> getter, and an explorer is not required to display or play ERC-20 media. Use Verify inscription or the standalone verifier if the explorer does not render it.</p>
 <p><a href="https://github.com/Chief-codes/carve-robinhood/blob/main/contracts/src/CarveToken.sol" target="_blank" rel="noreferrer">Token source</a> · <a href="https://github.com/Chief-codes/carve-robinhood/tree/main/contracts" target="_blank" rel="noreferrer">Build settings</a>. Solidity 0.8.37, Cancun, optimizer 200, via IR.</p>
 </Guide>
 </article>
 <aside className="panel readiness">
 <h2><ShieldCheck size={20}/> Official Carve links</h2>
 <a href="https://carvelaunch.com/">carvelaunch.com <ArrowUpRight size={14}/></a>
 <a href="https://x.com/CarveOnRh" target="_blank" rel="noopener noreferrer">@CarveOnRh on X <ArrowUpRight size={14}/></a>
 <a href="https://github.com/Chief-codes/carve-robinhood" target="_blank" rel="noreferrer">GitHub source <ArrowUpRight size={14}/></a>
 <p>Check addresses, not just names or logos. Carve runs on Robinhood Chain (4663).</p>
 <details><summary>Contract addresses and deployment proof</summary>
 {(['registry','factory','engine','router'] as const).map(name=>DEPLOYMENT[name]&&<a key={name} href={scan+'/address/'+DEPLOYMENT[name]+'?tab=contract'} target="_blank" rel="noreferrer">{name[0].toUpperCase()+name.slice(1)} contract <ArrowUpRight size={14}/></a>)}
 {DEPLOYMENT.deploymentTx&&<a href={scan+'/tx/'+DEPLOYMENT.deploymentTx} target="_blank" rel="noreferrer">Deployment receipt <ArrowUpRight size={14}/></a>}
 </details>
 <p>Internal testing is not an independent security audit. Tokens can lose value. Only publish media you have permission to share.</p>
 <a href="#/protocol">More about the launch mechanics <ArrowUpRight size={14}/></a>
 </aside></div>
 </>;}
