// Isolated prototype only; this is not part of the installed extension.
globalThis.probeEvents=[];
chrome.tabs.onActivated.addListener(event=>probeEvents.push({type:'active',...event}));
chrome.windows.onFocusChanged.addListener(windowId=>probeEvents.push({type:'focus',windowId}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
globalThis.captureProbe=async function(ownerId,urls){
 const before=await chrome.windows.get(ownerId);
 const activeBefore=(await chrome.tabs.query({windowId:ownerId,active:true}))[0].id;
 probeEvents.length=0;
 let tab,attached=false;
 const results=[];
 try{
  tab=await chrome.tabs.create({windowId:ownerId,url:'about:blank',active:false});
  await chrome.tabs.update(tab.id,{muted:true});
  const target={tabId:tab.id};
  await chrome.debugger.attach(target,'1.3');attached=true;
  for(const url of urls){
   await chrome.tabs.update(tab.id,{url});
   const deadline=Date.now()+10000;
   let ready=false;
   while(Date.now()<deadline){
    const current=await chrome.tabs.get(tab.id);
    if(current.status==='complete'&&current.url===url){
     const state=await chrome.debugger.sendCommand(target,'Runtime.evaluate',{expression:'document.documentElement.dataset.ready === "yes"',returnByValue:true});
     if(state.result.value===true){ready=true;break;}
    }
    await delay(100);
   }
   if(!ready)throw Error('Synthetic page did not become ready');
   const started=Date.now();
   let timer;
   const shot=await Promise.race([
    chrome.debugger.sendCommand(target,'Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Screenshot timed out')),10000);})
   ]).finally(()=>clearTimeout(timer));
   const bytes=Uint8Array.from(atob(shot.data),c=>c.charCodeAt(0));
   const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
   const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
   const pixel=(x,y)=>Array.from(ctx.getImageData(Math.floor(bitmap.width*x),Math.floor(bitmap.height*y),1,1).data).slice(0,3);
   results.push({url,width:bitmap.width,height:bitmap.height,background:pixel(.25,.75),canvas:pixel(.5,.5),elapsedMs:Date.now()-started,
    active:(await chrome.tabs.query({windowId:ownerId,active:true}))[0].id,window:await chrome.windows.get(ownerId)});
   bitmap.close();
  }
 }finally{
  try{if(attached)await chrome.debugger.detach({tabId:tab.id});}
  finally{if(tab)await chrome.tabs.remove(tab.id);}
 }
 await delay(200);
 return {before,after:await chrome.windows.get(ownerId),activeBefore,activeAfter:(await chrome.tabs.query({windowId:ownerId,active:true}))[0].id,
  events:[...probeEvents],results,remainingTargets:(await chrome.debugger.getTargets()).filter(target=>target.tabId===tab.id)};
};
