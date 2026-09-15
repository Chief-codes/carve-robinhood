# Carve

An independent onchain-media launchpad in development for Robinhood Chain (4663).

## Run and edit

Install Node.js 24 or later, open this folder in VS Code, and run:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5188. `npm run build` checks TypeScript and creates the production site. `npm test` checks asset processing and the wallet catalog.

Edit `src/App.tsx` for pages, `src/styles.css` for appearance, `src/components/AssetEditor.tsx` for preparation, and `src/lib/wallet.tsx` for extension handling. Optimized artwork and wallet logos are in `public/`.

## Live launchpad

Carve is live on Robinhood Chain (4663). A launch can include any non-empty combination of image, audio and website content. The app uploads the selected bytes onchain, creates the token and its immediate-trading curve in the same wallet-approved launch flow. It includes a public launch explorer, byte reconstruction and onchain trading UI.

The deployed contracts and exact validation record are listed in `docs/STATUS.md`. This repository contains no API keys, wallet secrets or seed phrases. Read the contracts, test independently and use a wallet you control; the project is not represented as a professional security audit.

## Hosting

The live site is deployed on Netlify. Public repository commits use GitHub's `users.noreply.github.com` address, so the owner’s personal email is not included in the public repository history.
