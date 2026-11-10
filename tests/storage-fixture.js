export function storageBytes(data,keys=null){
 const selected=new Set(keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys]);
 return [...selected].filter(key=>Object.hasOwn(data,key)).reduce((sum,key)=>sum+Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(data[key])),0);
}
