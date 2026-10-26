/** Accept only scoped ICE credentials; provider API keys do not belong here. */
export function voiceIceConfiguration(config: unknown): {iceServers: RTCIceServer[]; relayConfigured: boolean} {
  const iceServers: RTCIceServer[] = [{urls: 'stun:stun.cloudflare.com:3478'}];
  if (typeof config === 'string') {
    try {
      const parsed: unknown = JSON.parse(config);
      if (Array.isArray(parsed)) for (const item of parsed.slice(0, 8)) {
        if (!item || typeof item !== 'object') continue;
        const urls = typeof item.urls === 'string' ? [item.urls] : item.urls;
        if (!Array.isArray(urls) || !urls.length || urls.length > 8 || !urls.every(url => typeof url === 'string' && url.length <= 2048 && /^(stun|stuns|turn|turns):[^\s]+$/.test(url))) continue;
        const turn = urls.some(url => /^turns?:/.test(url));
        if (turn && (typeof item.username !== 'string' || !item.username || item.username.length > 512 || typeof item.credential !== 'string' || !item.credential || item.credential.length > 4096)) continue;
        iceServers.push({urls, ...(turn ? {username: item.username, credential: item.credential} : {})});
      }
    } catch { /* A malformed optional configuration must not disable direct audio. */ }
  }
  return {iceServers, relayConfigured: iceServers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/.test(url)))};
}
