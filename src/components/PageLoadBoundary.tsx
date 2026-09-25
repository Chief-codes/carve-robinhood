import {Component,type ReactNode} from 'react';

/** A failed/stale route download must not turn the whole website into a blank page.
 * Never reload automatically: a wallet approval or unsaved edit may be in progress.
 */
export class PageLoadBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<section className="panel page-load-error" role="alert"><h2>This page couldn’t finish loading.</h2><p>Check your connection, then refresh to try again. Your saved drafts remain on this device.</p><button className="primary" onClick={()=>location.reload()}>Refresh page</button></section>:this.props.children;}
}
