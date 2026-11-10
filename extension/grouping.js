// Website grouping is a presentation of the same records; never rewrite topics.
export function siteKey({domain}){
 const parts=domain.toLowerCase().split('.');
 while(parts.length>2&&['www','m'].includes(parts[0]))parts.shift();
 return parts.join('.');
}
export function siteSections(rows){
 const groups=new Map();
 for(const row of rows){const key=siteKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>({name,rows}));
}
export function groupingPreferences(value){
 return {tabs:value?.tabs==='site'?'site':'topic',bookmarks:value?.bookmarks==='site'?'site':'topic'};
}
