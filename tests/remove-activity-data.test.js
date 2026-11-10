import test from 'node:test';
import assert from 'node:assert/strict';
import {removeActivityData} from '../extension/remove-activity-data.js';

test('retired activity migration removes only duration data and is safe to repeat',async()=>{
 const data={visits:[{private:'discard'}],activityCursor:{at:1},trackingSince:1,config:{idleSeconds:300,recording:false,rules:[{keyword:'a',group:'Manual'}],settingsRevision:8},records:[{id:'manual',manualGroup:true,group:'Manual',activations:7,lastActivated:123}],apiKeys:{test:'synthetic'},other:'keep'};
 const session={activityRun:'run',mediaFrames:{a:1},classificationPreference:'keep'},alarms=new Set(['activity-checkpoint','data-maintenance','preview-checkpoint']);
 const keep=structuredClone(data);delete keep.visits;delete keep.activityCursor;delete keep.trackingSince;delete keep.config.idleSeconds;
 const api={alarms:{clear:async name=>alarms.delete(name)},storage:{local:{get:async key=>({[key]:data[key]}),remove:async keys=>keys.forEach(key=>delete data[key]),set:async patch=>Object.assign(data,patch)},session:{remove:async keys=>keys.forEach(key=>delete session[key])}}};
 await removeActivityData(api);await removeActivityData(api);
 assert.deepEqual(data,keep);assert.deepEqual(session,{classificationPreference:'keep'});assert.deepEqual([...alarms],['data-maintenance','preview-checkpoint']);
});
test('migration errors reject instead of claiming the cleanup finished',async()=>{
 const error=Error('Synthetic alarm failure');
 await assert.rejects(removeActivityData({alarms:{clear:async()=>{throw error;}}}),error);
});
