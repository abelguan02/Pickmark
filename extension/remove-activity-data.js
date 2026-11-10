// Run on the background queue before collection or maintenance. Removing the
// retired keys is idempotent; never read or rewrite page records or credentials.
export async function removeActivityData(api){
 await api.alarms.clear('activity-checkpoint');
 await api.storage.session.remove(['activityRun','mediaFrames']);
 await api.storage.local.remove(['visits','activityCursor','trackingSince']);
 const {config}=await api.storage.local.get('config');
 if(config&&Object.hasOwn(config,'idleSeconds')){
  const next={...config};delete next.idleSeconds;
  // This only shrinks config. Avoid retention writes during the migration.
  await api.storage.local.set({config:next});
 }
}
