"use strict";

// Photon search-as-you-type. Map clicks show coordinates without an extra
// reverse-geocoding request. A shared queue and cache limit requests per session.
class MapGeocoder {
    constructor(routeMap, options = {}) {
        this.routeMap = routeMap;
        this.searchEndpoint = options.searchEndpoint || "https://photon.komoot.io/api/";
        this.reverseEndpoint = options.reverseEndpoint || "https://photon.komoot.io/reverse";
        this.countryCodes = options.countryCodes ?? "gb";
        this.resultLimit = options.resultLimit ?? 10;
        this.debounceMilliseconds = options.debounceMilliseconds ?? 450;
        this.fields = {};
        this.listeners = {searchStarted:[], searchCompleted:[], searchFailed:[], locationSelected:[]};
        this.cleanups = [];
        this.queue = Promise.resolve();
        this.lastRequest = 0;
        this.cache = new Map();
        this.selecting = false;
    }
    initialise() {
        if (this.initialised) return;
        for (const type of ["start", "destination"]) {
            const input = document.getElementById(`${type}Location`);
            const box = document.createElement("div");
            box.className = "geocoder-suggestions";
            box.id = `${type}Suggestions`;
            box.hidden = true;
            box.setAttribute("role", "listbox");
            box.setAttribute("aria-label", `${type} search results`);
            input.parentElement.classList.add("geocoder-input-wrapper");
            input.parentElement.appendChild(box);
            input.setAttribute("role", "combobox");
            input.setAttribute("aria-controls", box.id);
            input.setAttribute("aria-expanded", "false");
            const field = this.fields[type] = {input,box,results:[],index:-1,controller:null,timer:null};
            const listen = (event, handler) => {
                input.addEventListener(event,handler);
                this.cleanups.push(() => input.removeEventListener(event,handler));
            };
            listen("input", () => {
                const text = input.value;
                field.controller?.abort(); field.results=[]; field.index=-1;
                this.hide(type);
                if(type === "start") this.routeMap.clearStart();
                else this.routeMap.clearDestination();
                input.value = text;
                clearTimeout(field.timer);
                if (text.trim().length >= 2) {
                    field.box.textContent = "Looking for matching places…"; this.show(type);
                    field.timer = setTimeout(() => this.submit(type), this.debounceMilliseconds);
                }
            });
            listen("keydown", event => {
                if(event.key === "Escape") this.hide(type);
                if(event.key === "Enter") {
                    event.preventDefault();
                    if(!box.hidden && field.index >= 0) this.select(type,field.index);
                    else this.submit(type);
                }
                if(["ArrowDown","ArrowUp"].includes(event.key) && field.results.length) {
                    event.preventDefault(); this.show(type);
                    field.index = Math.max(0,Math.min(field.results.length-1,
                        field.index + (event.key === "ArrowDown" ? 1 : -1)));
                    [...box.children].forEach((button,index) => {
                        button.classList.toggle("active",index === field.index);
                        button.setAttribute("aria-selected",String(index === field.index));
                    });
                    input.setAttribute("aria-activedescendant",`${type}Result${field.index}`);
                }
            });
            const changed = coordinate => {
                if(this.selecting) return;
                clearTimeout(field.timer);
                field.controller?.abort(); field.results=[]; this.hide(type);
                input.value = coordinate ? `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}` : "";
            };
            this.routeMap.on(`${type}Changed`,changed);
            this.cleanups.push(() => this.routeMap.off(`${type}Changed`,changed));
        }
        const outside = event => {
            for(const [type,field] of Object.entries(this.fields)) {
                if(!field.input.parentElement.contains(event.target)) this.hide(type);
            }
        };
        document.addEventListener("click",outside);
        this.cleanups.push(() => document.removeEventListener("click",outside));
        this.initialised = true;
    }
    initialize() { return this.initialise(); }
    async fetchJSON(url, signal) {
        const key = String(url);
        const run = async () => {
            signal?.throwIfAborted();
            if(this.cache.has(key)) return this.cache.get(key);
            await MapUtils.sleep(Math.max(0,1100 - (Date.now()-this.lastRequest)));
            signal?.throwIfAborted();
            this.lastRequest = Date.now();
            const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)]);
            const response = await fetch(key,{signal:requestSignal,headers:{Accept:"application/json"}});
            if(!response.ok) throw new Error(`Place search returned HTTP ${response.status}.`);
            const data = await response.json();
            this.cache.set(key,data);
            if(this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
            return data;
        };
        const pending = this.queue.then(run,run);
        this.queue = pending.catch(() => {});
        return pending;
    }
    normalise(raw) {
        const coordinate = raw?.geometry?.coordinates;
        if (!MapUtils.isValidCoordinate(coordinate)) return null;
        const p = raw.properties || {};
        const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "Location";
        const parts = [...new Set([name, p.street, p.district, p.city, p.county, p.state, p.postcode, p.country].filter(Boolean))];
        return {id:`${p.osm_type || ""}:${p.osm_id || ""}`, coordinate:[...coordinate],
            name, displayName:parts.join(", "), raw};
    }
    async search(query, signal) {
        if(String(query).trim().length < 2) return [];
        const url = new URL(this.searchEndpoint);
        for(const [key,value] of Object.entries({q:query,lang:"en",limit:this.resultLimit,dedupe:0})) {
            url.searchParams.set(key,String(value));
        }
        if(this.countryCodes) url.searchParams.set("countrycode",this.countryCodes.toUpperCase());
        const data = await this.fetchJSON(url,signal);
        if (!Array.isArray(data.features)) throw new Error("Invalid place-search response.");
        const seen = new Set();
        return data.features.map(raw=>this.normalise(raw)).filter(result => {
            if (!result) return false;
            const key = `${result.id}:${result.coordinate.join(",")}`;
            if (seen.has(key)) return false;
            seen.add(key); return true;
        });
    }
    async reverse(coordinate) {
        MapUtils.assertCoordinate(coordinate);
        const url = new URL(this.reverseEndpoint);
        url.searchParams.set("lon",coordinate[0]); url.searchParams.set("lat",coordinate[1]);
        const data = await this.fetchJSON(url);
        return this.normalise(data.features?.[0]);
    }
    async submit(type) {
        const field=this.fields[type], query=field.input.value.trim();
        clearTimeout(field.timer);
        if(query.length < 2) return;
        field.controller?.abort();
        const controller = field.controller = new AbortController();
        field.results=[]; field.index=-1;
        field.box.textContent="Searching places… please wait"; this.show(type);
        this.emit("searchStarted",{type,query});
        try {
            const results = await this.search(query,controller.signal);
            if(controller.signal.aborted) return;
            field.results=results; field.box.replaceChildren();
            if(!results.length) field.box.textContent="No places found. Try another name or choose on the map.";
            results.forEach((result,index)=>{
                const button=document.createElement("button");
                button.type="button"; button.className="geocoder-suggestion";
                button.id=`${type}Result${index}`; button.setAttribute("role","option");
                button.textContent=result.displayName;
                button.addEventListener("click",()=>this.select(type,index));
                field.box.appendChild(button);
            });
            this.emit("searchCompleted",{type,query,results});
        } catch(error) {
            if(controller.signal.aborted) return;
            field.box.textContent="Place search unavailable. You can still choose A and B on the map.";
            this.emit("searchFailed",{type,query,error});
        }
    }
    select(type,index) {
        const field=this.fields[type], result=field.results[index];
        if(!result) return;
        clearTimeout(field.timer);
        field.controller?.abort();
        this.selecting=true;
        try {
            field.input.value=result.displayName;
            if(type === "start") this.routeMap.setStart(result.coordinate,{flyTo:true});
            else this.routeMap.setDestination(result.coordinate,{flyTo:true});
        } finally { this.selecting=false; }
        this.hide(type); this.emit("locationSelected",{type,result});
    }
    show(type) { const f=this.fields[type]; f.box.hidden=false; f.input.setAttribute("aria-expanded","true"); }
    hide(type) {
        const f=this.fields[type]; f.box.hidden=true; f.index=-1;
        f.input.setAttribute("aria-expanded","false"); f.input.removeAttribute("aria-activedescendant");
    }
    clearInputs() { for(const type of Object.keys(this.fields)) { this.fields[type].input.value=""; this.hide(type); } }
    swapInputs() {
        const a=this.fields.start.input.value;
        this.fields.start.input.value=this.fields.destination.input.value;
        this.fields.destination.input.value=a;
    }
    on(event,callback) { if(!this.listeners[event]) throw new Error(`Unknown geocoder event ${event}`); this.listeners[event].push(callback); }
    emit(event,data) { for(const callback of this.listeners[event]) callback(data); }
    destroy() {
        for(const field of Object.values(this.fields)) {clearTimeout(field.timer);field.controller?.abort();field.box.remove();}
        for(const cleanup of this.cleanups) cleanup();
        this.cleanups=[]; this.initialised=false;
    }
}
window.MapGeocoder=MapGeocoder;
