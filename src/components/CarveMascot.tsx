/** High-resolution artwork with independently animated eyes, arms and boots. */
export function CarveMascot(){
 return <div className="carve-hd-mascot">
  <svg className="carve-rig" viewBox="0 0 1254 1254" role="img" aria-label="Carve raises a hand to greet you and blinks gently">
   <defs>
    <clipPath id="carve-greeting-arm"><path d="M916 660 L967 610 L956 510 L1110 400 L1254 415 L1254 950 L956 950 L920 820Z"/></clipPath>
    <clipPath id="carve-wand-cut"><path d="M0 510 H170 L335 605 L312 742 L342 996 H0Z"/></clipPath>
    <clipPath id="carve-left-shoe"><rect x="190" y="1090" width="345" height="164"/></clipPath>
    <clipPath id="carve-right-shoe"><rect x="625" y="1090" width="330" height="164"/></clipPath>
    <mask id="carve-still-body"><rect width="1254" height="1254" fill="white"/><path d="M934 660 L967 610 L956 510 L1110 400 L1254 415 L1254 950 L956 950 L938 820Z" fill="black"/><path d="M0 510 H170 L324 605 L301 742 L334 996 H0Z" fill="black"/><rect x="190" y="1104" width="345" height="150" fill="black"/><rect x="625" y="1104" width="330" height="150" fill="black"/></mask>
    <clipPath id="carve-left-eye"><path d="M454 502 C438 454 460 362 505 342 C554 317 604 345 625 392 C641 424 641 492 635 554 C568 556 505 538 454 502Z"/></clipPath>
    <clipPath id="carve-right-eye"><path d="M768 548 C759 500 765 441 786 412 C811 381 844 385 864 418 C887 455 890 509 880 554 C846 574 802 573 768 548Z"/></clipPath>
    <linearGradient id="carve-lid-shade" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#00633e"/><stop offset=".5" stopColor="#009963"/><stop offset="1" stopColor="#007848"/></linearGradient>
   </defs>
   <image href="/brand/carve-mascot-hd.png" width="1254" height="1254" mask="url(#carve-still-body)"/>
   <path className="carve-shoulder-fill" d="M326 625 Q282 732 260 846 Q267 941 344 1000 L361 929 L348 733Z" fill="url(#carve-lid-shade)" opacity="0"/>
   <g className="carve-left-boot"><image href="/brand/carve-mascot-hd.png" width="1254" height="1254" clipPath="url(#carve-left-shoe)"/></g>
   <g className="carve-right-boot"><image href="/brand/carve-mascot-hd.png" width="1254" height="1254" clipPath="url(#carve-right-shoe)"/></g>
   <g className="carve-wand-arm"><image href="/brand/carve-mascot-hd.png" width="1254" height="1254" clipPath="url(#carve-wand-cut)"/></g>
   <g className="carve-greeting-arm"><image href="/brand/carve-mascot-hd.png" width="1254" height="1254" clipPath="url(#carve-greeting-arm)"/></g>
   <g clipPath="url(#carve-left-eye)"><g className="carve-lid carve-lid-left"><rect x="435" y="315" width="220" height="255" fill="url(#carve-lid-shade)"/><path d="M458 504 Q540 555 632 522" fill="none" stroke="#003323" strokeWidth="8" strokeLinecap="round"/></g></g>
   <g clipPath="url(#carve-right-eye)"><g className="carve-lid carve-lid-right"><rect x="750" y="375" width="150" height="205" fill="url(#carve-lid-shade)"/><path d="M775 537 Q828 565 878 535" fill="none" stroke="#003323" strokeWidth="7" strokeLinecap="round"/></g></g>
  </svg>
 </div>;
}
