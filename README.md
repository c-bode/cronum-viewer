# Cronum Viewer (Vanilla Chrome Extension)

This starter extension detects the NFT on common marketplace pages and shows **public** Crona plus **unlockable** content (if you own the NFT). It uses the NFU descriptor + proof format you already publish on Arweave.

## Features
- Auto-detects NFT from tab (OpenSea paths, Etherscan token pages, and uploader query params like `nftUrl`).
- Queries Arweave GraphQL for `nfu.descriptor.v1` descriptors matching chain/contract/tokenId.
- Renders **public** items with inline **image preview** or **pretty JSON**.
- Unlocks **encrypted** items with Lit Protocol (`encryptToJson` packs). (Local AES-GCM is stubbed; see notes.)
- “Add Cronum” button that links to your uploader, passing the current NFT as a URL param.

## Setup
1. Ensure your descriptors include the NFU tags your uploader emits, e.g. `App-Name: NFU-Uploader`, `NFU-Schema: nfu.descriptor.v1`, etc.
2. In `lib/util.js`, set `UPLOADER_URL` to your uploader page.
3. Lit SDK is bundled locally at `lib/lit.bundle.esm.js` and loaded by default from the extension package.
4. Load unpacked:
   - Go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
5. Open a marketplace NFT page, click the extension, and **Refresh**.

## Notes on Unlockables
- This extension supports Lit `encryptToJson` packs (most common path).
- The **local AES-GCM** fallback requires the `encryptedSymmetricKey` returned by Lit when saving the key. If your descriptors don’t store it, retrieval won’t be possible; prefer `encryptToJson` for now (or extend your descriptors to include that field).

## Security
- RPC calls go to public endpoints (Cloudflare, Polygon, Arbitrum, Optimism, Base). Swap if you prefer your own providers.
- No private keys are handled here; MetaMask is used for `personal_sign` when needed.

## Development
All code is vanilla JS modules. `popup/popup.js` is the main UI, `content/detect.js` parses the current tab, and `lib/` contains helpers.
