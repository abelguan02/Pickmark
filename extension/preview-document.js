// Self-contained function serialized by chrome.scripting into the helper's
// isolated main frame. No listener, timer, page text or form values are retained.
export function previewDocumentState(){
 return {url:location.href,ready:document.readyState!=='loading'&&!!document.body,visible:document.visibilityState==='visible'};
}
