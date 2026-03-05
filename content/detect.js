(function(){
  function safeDecode(s){
    if(typeof s !== 'string') return '';
    let out = s;
    // Some sources double-encode values (e.g. %253A). Decode a few rounds.
    for(let i = 0; i < 3; i++){
      try{
        const dec = decodeURIComponent(out);
        if(dec === out) break;
        out = dec;
      }catch{
        break;
      }
    }
    return out;
  }

  function parseUploaderQuery(url){
    const chain = (url.searchParams.get('chain') || 'ethereum').toLowerCase();
    const standard = (url.searchParams.get('standard') || 'erc721').toLowerCase();
    const contract = (url.searchParams.get('contract') || '').trim();
    const tokenId = (url.searchParams.get('tokenId') || '').trim();
    if(contract && tokenId){
      return { chain, contract, tokenId, standard };
    }

    const rawNftUrl = url.searchParams.get('nftUrl');
    if(!rawNftUrl) return null;

    const decoded = safeDecode(rawNftUrl).trim();
    if(!decoded) return null;

    // Common uploader format: <contract>:<tokenId>
    const colon = decoded.match(/^([^:]+):(.+)$/);
    if(colon){
      return {
        chain,
        contract: colon[1].trim(),
        tokenId: colon[2].trim(),
        standard
      };
    }

    // Also accept path-ish format: <chain>/<contract>/<tokenId>
    const parts = decoded.split('/').filter(Boolean);
    if(parts.length >= 3){
      return {
        chain: (parts[0] || chain).toLowerCase(),
        contract: parts[1],
        tokenId: parts[2],
        standard
      };
    }

    return null;
  }

  function parseNFTFromURL(u){
    try{
      const url = new URL(u);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split('/').filter(Boolean);

      // Cronum uploader: token info can come via query params (e.g. nftUrl).
      const fromQuery = parseUploaderQuery(url);
      if(fromQuery && fromQuery.contract && fromQuery.tokenId){
        return fromQuery;
      }

      // OpenSea: /assets/<chain>/<contract>/<tokenId> or /item/<chain>/<contract>/<tokenId>
      let i = parts.indexOf('assets');
      if(i >= 0 && parts.length >= i+4){
        return { chain: parts[i+1], contract: parts[i+2], tokenId: parts[i+3], standard: 'erc721' };
      }
      i = parts.indexOf('item');
      if(i >= 0 && parts.length >= i+4){
        return { chain: parts[i+1], contract: parts[i+2], tokenId: parts[i+3], standard: 'erc721' };
      }

      // Etherscan: /token/<contract>?a=<tokenId>
      if(host.endsWith('etherscan.io')){
        if(parts[0] === 'token' && parts[1]){
          const contract = parts[1];
          const tokenId = url.searchParams.get('a') || '';
          if(tokenId) return { chain: 'ethereum', contract, tokenId, standard: 'erc721' };
        }
      }

      // Blur (heuristic): /eth/<contract>/<tokenId>
      if(host.includes('blur.io') && parts.length >= 3){
        const chain = (parts[0] === 'eth') ? 'ethereum' : parts[0];
        const contract = parts[1];
        const tokenId = parts[2];
        if(contract && tokenId) return { chain, contract, tokenId, standard: 'erc721' };
      }

      // Foundation (heuristic): /contracts/<contract>/tokens/<tokenId>
      i = parts.indexOf('contracts');
      if(i >= 0 && parts.length >= i+3 && parts[i+2] === 'tokens'){
        return { chain: 'ethereum', contract: parts[i+1], tokenId: parts[i+3], standard: 'erc721' };
      }

    }catch(e){}
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if(msg && msg.type === 'CRONUM_GET_NFT'){
      const nft = parseNFTFromURL(location.href);
      sendResponse({ nft });
    }
  });
})();