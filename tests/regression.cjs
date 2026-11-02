'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
global.window=global;
global.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),1);
global.cancelAnimationFrame=clearTimeout;
global.document={readyState:'loading',addEventListener(){},getElementById(){return null},querySelector(){return null}};
const captured=[];
const output=console.log;
console.log=console.info=(...args)=>captured.push(args);
for(const name of ['utils','priority-queue','map-data','graph','astar','visualiser','routes','app']) {
 vm.runInThisContext(fs.readFileSync(`${__dirname}/../js/${name}.js`,'utf8'),{filename:`${name}.js`});
}
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
const node=(id,x,y=0)=>({type:'node',id,lon:x,lat:y});
const way=(id,nodes,tags={})=>({type:'way',id,nodes,tags:{highway:'residential',...tags}});
const graph=(elements)=>RoadGraph.fromNetwork(new MapData().parseOverpassData({elements}));
const local=()=>graph([node(1,0),node(2,.001),node(3,.002),node(4,.001,.001),way(10,[1,2,3]),way(11,[2,4])]);
const badGoal=()=>graph([node(1,0),node(2,.001),node(3,.00101),way(10,[1,2]),way(11,[3,2],{oneway:'yes'})]);
test('short connected route stops at exact goal; IDs canonical',async()=>{
 const g=local(),s=new AStarSearch(g),visited=[];s.on('nodeVisited',e=>visited.push(e.nodeId));
 const r=await s.search(1,'3');assert(r.success);assert.deepEqual(r.path,['1','2','3']);
 assert(!visited.includes('4'));assert.equal(s.isRunning(),false);assert(s.isFinished());
 assert.equal(r.distance,g.calculatePathDistance(r.path));assert([...g.nodes.keys()].every(id=>typeof id==='string'));
});
test('Dijkstra and A* agree on shortest distance',async()=>{
 const g=local(),a=await new AStarSearch(g).search(1,3),d=await new AStarSearch(g,{algorithm:'dijkstra'}).search(1,3);
 assert(Math.abs(a.distance-d.distance)<1e-8);assert(a.statistics.visitedNodes<=d.statistics.visitedNodes);
});
test('original visual-near-B failure reproduced; reachable snap repairs it',async()=>{
 const g=badGoal(),nearest=g.findNearestNode([.00101,0]);
 assert.equal(nearest.nodeId,'3');assert.equal(nearest.incomingDegree,0);
 for(const algorithm of ['astar','dijkstra']) assert(!(await new AStarSearch(g,{algorithm}).search('1','3')).success);
 const snapped=await g.snapReachable([0,0],[.00101,0]);assert(snapped.success);
 assert.equal(snapped.destination.nodeId,'2');assert(snapped.destination.distance<2);
 const r=await new AStarSearch(g).search(snapped.start.nodeId,snapped.destination.nodeId);assert(r.success);assert.equal(r.path.at(-1),'2');
});
test('goal with incoming edges but in another component is not selected',async()=>{
 const g=graph([node(1,0),node(2,.001),node(3,.00101),node(4,.00102),way(10,[1,2]),way(11,[3,4])]);
 const snap=await g.snapReachable([0,0],[.00101,0]);assert.equal(snap.destination.nodeId,'2');
});
test('one-way forward and reverse are respected',async()=>{
 for(const [tag,a,b] of [['yes','1','2'],['-1','2','1']]) {
  const g=graph([node(1,0),node(2,.001),way(10,[1,2],{oneway:tag})]);
  assert((await new AStarSearch(g).search(a,b)).success);assert(!(await new AStarSearch(g).search(b,a)).success);
 }
});
test('roundabout/motorway defaults and explicit no overrides',()=>{
 const data=new MapData();
 for(const highway of ['residential','motorway','motorway_link']) {
  for(const tags of [{highway,junction:'roundabout'},{highway:'motorway'},{highway:'motorway_link'}]) {
   const raw={elements:[node(1,0),node(2,.001),way(10,[1,2],tags)]};
   assert.equal(data.parseOverpassData(raw).ways[0].direction,'forward');
   raw.elements[2].tags.oneway='no';assert.equal(data.parseOverpassData(raw).ways[0].direction,'both');
  }
 }
});
test('missing OSM nodes and Overpass partial errors rejected',()=>{
 const d=new MapData();assert.throws(()=>d.parseOverpassData({elements:[node(1,0),node(3,.002),way(1,[1,2,3])]}),/missing node/);
 assert.throws(()=>d.parseOverpassData({elements:[],remark:'runtime error: timeout'}),/incomplete/);
});
test('access hierarchy honours specific vehicle permissions',()=>{
 const g=graph([node(1,0),node(2,.001),node(3,.002),node(4,.003),
  way(10,[1,2],{access:'no',motor_vehicle:'yes'}),way(11,[2,3],{motorcar:'no'}),way(12,[3,4],{access:'private'})]);
 assert(g.getEdge(1,2));assert(!g.hasNode(3));assert(!g.hasNode(4));
});
test('coincident distinct OSM nodes remain connected',async()=>{
 const g=graph([node(1,0),node(2,0),node(3,.001),way(1,[1,2,3])]);
 assert(g.getEdge(1,2));assert.equal(g.getEdge(1,2).distance,0);assert((await new AStarSearch(g).search(1,3)).success);
});
test('spatial candidates match brute force near cell edges and high latitudes',()=>{
 const elements=[];
 for(let i=0;i<60;i++) elements.push(node(i+1,.009 + i*.00008,75+(i%5)*.0001));
 elements.push(way(100,Array.from({length:60},(_,i)=>i+1)));
 const g=graph(elements),p=[.01,75.00015];
 const brute=g.getNodes().map(n=>({nodeId:n.id,d:MapUtils.haversineDistance(p,n.coordinate)})).filter(x=>x.d<=100).sort((a,b)=>a.d-b.d);
 assert.deepEqual(g.findNearestCandidates(p,{maximumDistance:100}).map(x=>x.nodeId),brute.map(x=>x.nodeId));
});
test('snap radius and extra-distance guard avoid far false destinations',async()=>{
 const g=graph([node(1,0),node(2,.001),node(3,.01),node(4,.011),way(10,[1,2]),way(11,[3,4])]);
 assert.equal((await g.snapReachable([0,0],[.01,0])).success,false);
 assert.equal((await g.snapReachable([20,20],[.01,0])).reason,'snap-distance');
});
test('disconnected searches terminate cleanly for both algorithms',async()=>{
 const g=graph([node(1,0),node(2,.001),node(3,.01),node(4,.011),way(10,[1,2]),way(11,[3,4])]);
 for(const algorithm of ['astar','dijkstra']) {
  const r=await new AStarSearch(g,{algorithm}).search(1,4);assert(!r.success);assert.equal(r.statistics.visitedNodes,2);
 }
});
test('same-node result has valid coordinates and empty frontier',async()=>{
 const r=await new AStarSearch(local()).search(1,1);assert(r.success);assert.equal(r.distance,0);assert.equal(r.coordinates.length,1);assert.equal(r.statistics.currentFrontierSize,0);
});
test('stale entries ignored, and better paths reopen closed nodes',async()=>{
 const g=graph([node(1,0),node(2,.001),node(3,.002),node(4,.003),node(5,.004),
  way(10,[1,2],{oneway:'yes'}),way(11,[1,3],{oneway:'yes'}),way(12,[3,2],{oneway:'yes'}),way(13,[2,4],{oneway:'yes'}),way(14,[4,5],{oneway:'yes'})]);
 const weights={'1>2':3,'1>3':1,'3>2':1,'2>4':1,'4>5':100};
 for(const edge of g.getEdges()) edge.weight=weights[`${edge.from}>${edge.to}`];
 // Deliberately inconsistent but admissible heuristic to exercise reopening.
 g.heuristic=(a)=>a==='3'?3:0;
 const r=await new AStarSearch(g).search(1,5);
 assert(r.success);assert.equal(r.weight,103);assert(r.statistics.reopenedNodes>=1);assert(r.statistics.staleQueueEntries>=1);
});
test('pause/resume and cancellation yield to the event loop',async()=>{
 const s=new AStarSearch(local(),{stepDelay:5});let visits=0;
 s.on('nodeVisited',()=>{visits++;if(visits===1)s.pause();});
 const pending=s.search(1,3);await MapUtils.sleep(15);assert(s.isPaused());assert.equal(visits,1);
 s.resume();assert((await pending).success);
 const c=new AStarSearch(local());c.on('start',()=>c.cancel());assert((await c.search(1,3)).cancelled);
});
test('reachability check can be cancelled before routing',async()=>{
 let calls=0;await assert.rejects(()=>local().snapReachable([0,0],[.002,0],{checkCancelled(){if(++calls>1)throw new Error('cancelled');}}),/cancelled/);
});
class FakeMap {
 constructor(){this.sources=new Map();this.layers=[];}
 isStyleLoaded(){return true} on(){} off(){} getStyle(){return {layers:this.layers}}
 addSource(id,o){this.sources.set(id,{data:o.data,setData(data){this.data=data}})}
 getSource(id){return this.sources.get(id)} removeSource(id){this.sources.delete(id)}
 addLayer(layer,before){const at=this.layers.findIndex(x=>x.id===before);at<0?this.layers.push(layer):this.layers.splice(at,0,layer)}
 getLayer(id){return this.layers.find(x=>x.id===id)} removeLayer(id){this.layers=this.layers.filter(x=>x.id!==id)}
 moveLayer(id){const l=this.getLayer(id);this.removeLayer(id);this.layers.push(l)}
 setLayoutProperty(){} fitBounds(){} flyTo(){}
}
function appHarness(networks,start=[0,0],end=[.02,0]) {
 const map=new FakeMap(),a=new MapApp(),calls=[],status=[];
 a.routeMap={getMap:()=>map,getStart:()=>start,getDestination:()=>end,fitCoordinates(){},clearAlgorithmVisualisation(){},showSnappedEndpoints(){},clearSnappedEndpoints(){}};
 a.elements.searchSpeed={value:'100',min:'1',max:'100'};
 a.mapData={loadBetween:async(s,d,options)=>{calls.push(options);return networks[Math.min(calls.length-1,networks.length-1)]},cancel(){}};
 a.routeRenderer=new RouteRenderer(a.routeMap);
 const baseStatus=a.setStatus.bind(a);a.setStatus=(s,t)=>{status.push(s);baseStatus(s,t)};
 return {app:a,calls,map,status};
}
const net=(elements)=>new MapData().parseOverpassData({elements});
const apart=()=>net([node(1,0),node(2,.001),node(3,.019),node(4,.02),way(10,[1,2]),way(11,[3,4])]);
const joined=()=>net([node(1,0),node(2,.001),node(3,.019),node(4,.02),way(10,[1,2,3,4])]);
test('whole pipeline retries with wider bounds and draws exact final route on top',async()=>{
 const {app,calls,map}=appHarness([apart(),joined()]);const r=await app.runRoute();
 assert(r?.success);assert.equal(calls.length,2);assert.equal(calls[1].paddingMultiplier,2.5);
 assert.equal(r.path.at(-1),'4');assert.equal(map.layers.at(-1).id,'route-result-line');
 assert.deepEqual(map.getSource('route-result-source').data.features[0].geometry.coordinates,r.coordinates);
 assert.equal(app.running,false);assert.equal(app.progressTimer,null);app.destroyVisualiser();
});
test('whole pipeline gives bounded no-route after two attempts',async()=>{
 const {app,calls}=appHarness([apart()]);const r=await app.runRoute();assert.equal(r.success,false);assert.equal(calls.length,2);assert.match(r.reason,/No directed route/);assert.equal(app.search,null);
});
test('whole pipeline same-node route does not throw in renderer',async()=>{
 const {app}=appHarness([joined()],[0,0],[0,0]);const r=await app.runRoute();assert(r.success);assert.equal(r.distance,0);app.destroyVisualiser();
});
test('older request cannot stop a newer progress timer',async()=>{
 const {app}=appHarness([joined()]);let release;
 app.mapData.loadBetween=()=>new Promise(resolve=>release=resolve);
 const pending=app.runRoute();await MapUtils.sleep(1);
 app.clearSearch();app.startProgressMonitor('download');const timer=app.progressTimer;
 release(joined());await pending;assert.equal(app.progressTimer,timer);app.stopProgressMonitor();
});
test('padding retry grows both dimensions including east-west journeys',()=>{
 const d=new MapData(),a=d.createBounds([0,0],[.05,0]),b=d.createBounds([0,0],[.05,0],null,2.5);
 assert(b.north>a.north&&b.south<a.south&&b.east>a.east&&b.west<a.west);
});
test('large graph A* and Dijkstra cost agreement; browser-yield heartbeat',async()=>{
 const elements=[],size=35;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++)elements.push(node(1+y*size+x,x*.0001,y*.0001));
 let id=10000;
 for(let y=0;y<size;y++)elements.push(way(id++,Array.from({length:size},(_,x)=>1+y*size+x)));
 for(let x=0;x<size;x++)elements.push(way(id++,Array.from({length:size},(_,y)=>1+y*size+x)));
 const g=graph(elements);let beats=0;const timer=setInterval(()=>beats++,1);
 const a=await new AStarSearch(g,{yieldEvery:50}).search(1,size*size),d=await new AStarSearch(g,{algorithm:'dijkstra',yieldEvery:50}).search(1,size*size);
 clearInterval(timer);assert(Math.abs(a.distance-d.distance)<1e-6);assert(beats>0);
});
test('HTTP 504 retries the same road area once and succeeds',async()=>{
 const original=global.fetch,d=new MapData();d.retryDelayMilliseconds=0;let calls=0;
 const bodies=[];
 global.fetch=async(url,o)=>{calls++;bodies.push(String(o.body));return calls===1?{ok:false,status:504}:{ok:true,json:async()=>({elements:[node(1,0),node(2,.001),way(10,[1,2])]})}};
 try {const n=await d.loadBetween([0,0],[.001,0]);assert.equal(n.nodeCount,2);assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);}
 finally {global.fetch=original;}
});
test('repeated 504 is bounded and cancellation prevents retry',async()=>{
 const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return {ok:false,status:504}};
 try {
  const d=new MapData();d.retryDelayMilliseconds=0;
  await assert.rejects(()=>d.loadBetween([0,0],[.001,0]),/after two attempts/);assert.equal(calls,2);
  calls=0;const c=new MapData();c.retryDelayMilliseconds=30;
  const pending=c.loadBetween([0,0],[.001,0]);await MapUtils.sleep(5);c.cancel();
  await assert.rejects(()=>pending);assert.equal(calls,1);
 } finally {global.fetch=original;}
});
(async()=>{
 let failed=0;
 for(const [name,fn] of tests){try{await fn();output(`PASS ${name}`)}catch(e){failed++;output(`FAIL ${name}\n${e.stack}`)}}
 output(`${tests.length-failed}/${tests.length} tests passed`);process.exitCode=failed?1:0;
})();
