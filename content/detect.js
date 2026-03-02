(function(){
  function parseNFTFromURL(u){
    try{
      const url = new URL(u);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split('/').filter(Boolean);

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