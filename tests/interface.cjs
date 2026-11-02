'use strict';
// Deterministic DOM/MapLibre adapters exercise application event wiring without
// claiming a real WebGL/browser test. No third-party test dependencies required.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const output=console.log;console.log=console.info=()=>{};
global.window=global;
global.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),1);
global.cancelAnimationFrame=clearTimeout;
class Element {
 constructor(){this.handlers={};this.children=[];this.value='';this.attrs={};this.dataset={};this.style={};this.textContent='';this.classList={add(){},remove(){},toggle(){}};this.parentElement={classList:this.classList,appendChild(){},contains(){return true}};}
 addEventListener(e,f){(this.handlers[e]??=[]).push(f)} removeEventListener(e,f){this.handlers[e]=(this.handlers[e]||[]).filter(x=>x!==f)}
 fire(e,event={}){for(const f of this.handlers[e]||[])f({preventDefault(){},target:this,...event})}
 setAttribute(k,v){this.attrs[k]=v} removeAttribute(k){delete this.attrs[k]}
 appendChild(c){this.children.push(c)} replaceChildren(){this.children=[]} remove(){} getBoundingClientRect(){return {width:1000,height:690}} contains(){return false}
}
const html=fs.readFileSync(`${__dirname}/../index.html`,'utf8'),elements=new Map();
for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))elements.set(id,new Element());
const heading=new Element(),formula=new Element();
global.document={readyState:'loading',getElementById:id=>elements.get(id)||null,createElement:()=>new Element(),
 querySelector:s=>s==='.formula'?formula:heading,addEventListener(){},removeEventListener(){}};
elements.get('searchSpeed').value='100';elements.get('searchSpeed').min='1';elements.get('searchSpeed').max='100';
elements.get('algorithmSelect').value='astar';elements.get('heuristicSelect').value='distance';
class FakeMap {
 constructor(o){this.sources=new Map();this.layers=[...o.style.layers];this.handlers={};this.center={lng:0,lat:0};}
 loaded(){return true} isStyleLoaded(){return true} on(e,f){(this.handlers[e]??=[]).push(f)} off(){} once(){}
 fire(e,d){for(const f of this.handlers[e]||[])f(d)}
 addSource(id,o){this.sources.set(id,{...o,setData(data){this.data=data}})} getSource(id){return this.sources.get(id)} removeSource(id){this.sources.delete(id)}
 addLayer(l,b){const i=this.layers.findIndex(x=>x.id===b);i<0?this.layers.push(l):this.layers.splice(i,0,l)}
 getLayer(id){return this.layers.find(l=>l.id===id)} removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)}
 moveLayer(id){const l=this.getLayer(id);this.removeLayer(id);this.layers.push(l)}
 setLayoutProperty(id,k,v){const l=this.getLayer(id);(l.layout??={})[k]=v}
 getCanvas(){return {style:{}}} resize(){} jumpTo(o){this.center={lng:o.center[0],lat:o.center[1]}} getCenter(){return this.center} getZoom(){return 11}
 flyTo(){} fitBounds(){} remove(){}
}
class Marker {constructor(o){this.options=o}setLngLat(p){this.coordinate=p;return this}addTo(m){return this}remove(){this.removed=true}}
global.maplibregl={Map:FakeMap,Marker,LngLatBounds:class{extend(){return this}}};
for(const f of ['utils','priority-queue','map','geocoder','map-data','graph','astar','visualiser','routes','app']) vm.runInThisContext(fs.readFileSync(`${__dirname}/../js/${f}.js`,'utf8'));
let requests=0;
global.fetch=async()=>{requests++;return {ok:true,json:async()=>({features:[{type:'Feature',geometry:{type:'Point',coordinates:[-.127,51.507]},properties:{osm_id:1,osm_type:'N',name:'Test street',city:'London'}},{type:'Feature',geometry:{type:'Point',coordinates:[-1.5,53.8]},properties:{osm_id:2,osm_type:'N',name:'Test street',city:'Leeds'}}]})}};
(async()=>{
 const app=await startMapApp();assert(app.initialised);
 output('PASS complete application initialises and wires HTML controls');
 const map=app.routeMap.getMap();
 elements.get('pickStart').fire('click');map.fire('click',{lngLat:{lng:0,lat:0}});
 elements.get('pickDestination').fire('click');map.fire('click',{lngLat:{lng:.002,lat:0}});
 assert.deepEqual(app.routeMap.getStart(),[0,0]);assert.deepEqual(app.routeMap.getDestination(),[.002,0]);assert.equal(elements.get('findRoute').disabled,false);
 assert.equal(elements.get('destinationLocation').value,'0.00000, 0.00200');
 elements.get('swapRoute').fire('click');assert.deepEqual(app.routeMap.getStart(),[.002,0]);assert.equal(elements.get('startLocation').value,'0.00000, 0.00200');
 output('PASS point selection, input synchronisation, swap and run enablement');
 const input=elements.get('startLocation');input.value='London';input.fire('input');
 await MapUtils.sleep(5);assert.equal(requests,0);assert.equal(app.routeMap.getStart(),null);
 await MapUtils.sleep(500);assert.equal(requests,1);
 const field=app.geocoder.fields.start;assert.equal(field.results.length,2);assert.notEqual(field.results[0].displayName,field.results[1].displayName);field.box.children[0].fire('click');
 assert.deepEqual(app.routeMap.getStart(),[-.127,51.507]);assert.equal(input.value,'Test street, London');
 await app.geocoder.search('London');assert.equal(requests,1);
 const destinationInput=elements.get('destinationLocation');
 destinationInput.value='Castleford';destinationInput.fire('input');
 await MapUtils.sleep(1200);
 const destinationField=app.geocoder.fields.destination;assert.equal(destinationField.results.length,2);
 destinationField.box.children[1].fire('click');assert.deepEqual(app.routeMap.getDestination(),[-1.5,53.8]);
 assert.equal(destinationInput.value,'Test street, Leeds');
 output('PASS automatic suggestions in both fields, same-name choices, selected coordinates and caching');
 // Actual search events drive the pause button and final geometry.
 app.routeMap.setStart([0,0]);app.routeMap.setDestination([.002,0]);
 const raw={elements:[{type:'node',id:1,lon:0,lat:0},{type:'node',id:2,lon:.001,lat:0},{type:'node',id:3,lon:.002,lat:0},
 {type:'way',id:10,nodes:[1,2,3],tags:{highway:'residential'}}]};
 app.mapData.loadBetween=async()=>new MapData().parseOverpassData(raw);
 elements.get('searchSpeed').value='1';
 const pending=app.runRoute();
 for(let i=0;i<100&&!app.search?.isRunning();i++)await MapUtils.sleep(2);
 assert(app.search.isRunning());assert.equal(elements.get('pauseSearch').disabled,false);
 elements.get('pauseSearch').fire('click');assert(app.search.isPaused());assert.equal(elements.get('pauseSearch').textContent,'Resume');
 elements.get('pauseSearch').fire('click');assert(!app.search.isPaused());
 elements.get('searchSpeed').value='100';elements.get('searchSpeed').fire('input');
 const result=await pending;assert(result.success);assert.equal(app.routeMap.snapMarkers.length,2);
 output('PASS search start enables Pause, Resume works, speed changes and exact snap markers render');
 const source=map.getSource('route-result-source'),data=source.data;
 elements.get('basemapSelect').value='satellite';elements.get('basemapSelect').fire('change');
 assert.equal(map.getLayer('carto-basemap-layer').layout.visibility,'none');assert.equal(source.data,data);
 elements.get('basemapSelect').value='road';elements.get('basemapSelect').fire('change');
 assert.equal(map.getLayer('carto-basemap-layer').layout.visibility,'visible');assert.equal(source.data,data);
 elements.get('algorithmSelect').value='dijkstra';elements.get('algorithmSelect').fire('change');
 assert.equal(elements.get('heuristicSelect').disabled,true);assert.equal(formula.textContent,'f(n) = g(n)');
 output('PASS basemap switching preserves route and algorithm labels follow selection');
 elements.get('clearSearch').fire('click');assert.equal(app.routeMap.snapMarkers.length,0);assert.equal(app.lastResult,null);assert.deepEqual(app.routeMap.getStart(),[0,0]);assert.equal(map.getSource('route-result-source').data.features.length,0);
 output('PASS Clear removes overlays and preserves chosen A/B');
 app.destroy();output('6/6 interface-adapter tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
