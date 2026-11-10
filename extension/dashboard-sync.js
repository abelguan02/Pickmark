// Reading the dashboard also refreshes lastSeen. Ignore that bookkeeping field
// so reacting to storage writes cannot create a get -> write -> get loop.
export function recordsChanged({oldValue=[],newValue=[]}) {
  const relevant=records=>JSON.stringify(records.map(({lastSeen,...record})=>record));
  return relevant(oldValue)!==relevant(newValue);
}

// Match collection's last nonempty title; keep this identity on the rendered row
// so a stale close action cannot silently target a different copy of the URL.
export function withTabTargets(records,tabs){
  const targets=new Map();
  for(const tab of tabs)if(!tab.incognito&&(!targets.has(tab.url)||tab.title))targets.set(tab.url,tab.id);
  return records.map(record=>({...record,tabId:targets.get(record.url)}));
}
