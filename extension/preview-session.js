export const PREVIEW_WINDOW_KEY='pickmark-preview-window-v1';
export const PREVIEW_JOB_KEY='pickmark-preview-job-v1';

// Register the empty helper tab before navigating it to any website.
// Session storage also protects collection when the MV3 worker restarts.
export async function userTabs(api,query={}){
 const session=await api.storage.session.get(PREVIEW_WINDOW_KEY);
 const tabs=await api.tabs.query(query);
 const scope=session[PREVIEW_WINDOW_KEY];
 return tabs.filter(tab=>!scope||(scope.kind==='tab'?tab.id!==scope.tabId:tab.windowId!==scope.windowId));
}
