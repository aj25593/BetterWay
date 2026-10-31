const $=id=>document.getElementById(id);
const KEY="hamburg-route-stops-v2";
let stops=JSON.parse(localStorage.getItem(KEY)||"[]"), start=null, markers=[], routeLayer=null, map;
const MAX=20;
map=L.map("map").setView([53.5511,9.9937],11);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
function save(){localStorage.setItem(KEY,JSON.stringify(stops))}
function msg(t){$("status").textContent=t}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function geocode(q){
 const u="https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&q="+encodeURIComponent(q);
 const r=await fetch(u,{headers:{"Accept-Language":"de"}});
 if(!r.ok) throw Error("Adresssuche gerade nicht erreichbar.");
 const d=await r.json(); if(!d.length) throw Error("Adresse nicht gefunden. Bitte genauer eingeben.");
 return {lat:+d[0].lat,lon:+d[0].lon,label:d[0].display_name};
}
async function add(){
 const q=$("address").value.trim(); if(!q)return;
 if(stops.length>=MAX){msg("Maximal 20 Ziele.");return}
 $("add").disabled=true;msg("Suche Adresse …");
 try{const p=await geocode(q);stops.push({query:q,lat:p.lat,lon:p.lon,label:p.label});$("address").value="";save();render();msg("Ziel hinzugefügt.");}
 catch(e){msg(e.message)} finally{$("add").disabled=false}
}
$("add").onclick=add;$("address").addEventListener("keydown",e=>{if(e.key==="Enter")add()});
function render(){
 $("count").textContent=stops.length+"/"+MAX;
 $("stops").innerHTML=stops.map((s,i)=>`<li class="stop"><span class="num">${i+1}</span><div class="stoptext"><div class="stopname">${esc(s.query)}</div><div class="stopmeta">${esc(s.label||"")}</div></div><div class="move"><button data-up="${i}" ${i===0?"disabled":""}>↑</button><button data-down="${i}" ${i===stops.length-1?"disabled":""}>↓</button></div><button class="danger remove" data-del="${i}" aria-label="Löschen">×</button></li>`).join("");
 $("stops").querySelectorAll("[data-up]").forEach(b=>b.onclick=()=>move(+b.dataset.up,-1));
 $("stops").querySelectorAll("[data-down]").forEach(b=>b.onclick=()=>move(+b.dataset.down,1));
 $("stops").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{stops.splice(+b.dataset.del,1);save();render();});
 $("allMaps").disabled=!stops.length;$("next").disabled=!stops.length;
 drawMap(); $("distance").textContent="–";$("duration").textContent="–";
 if(stops.length>=2) calculateRoute();
}
function move(i,d){const j=i+d;if(j<0||j>=stops.length)return;[stops[i],stops[j]]=[stops[j],stops[i]];save();render()}
function drawMap(){
 markers.forEach(m=>map.removeLayer(m));markers=[];if(routeLayer){map.removeLayer(routeLayer);routeLayer=null}
 const pts=[];
 stops.forEach((s,i)=>{const m=L.marker([s.lat,s.lon],{icon:L.divIcon({className:"",html:`<div style="background:#087cff;color:white;border:2px solid white;border-radius:50%;width:29px;height:29px;display:grid;place-items:center;font-weight:800;box-shadow:0 1px 5px #3338">${i+1}</div>`,iconSize:[29,29],iconAnchor:[14,14]})}).addTo(map).bindPopup(`<b>${i+1}. ${esc(s.query)}</b>`);markers.push(m);pts.push([s.lat,s.lon])});
 if(start){const m=L.circleMarker([start.lat,start.lon],{radius:8,color:"#fff",weight:2,fillColor:"#30b454",fillOpacity:1}).addTo(map).bindPopup("Start: mein Standort");markers.push(m);pts.push([start.lat,start.lon])}
 if(pts.length)map.fitBounds(L.latLngBounds(pts).pad(.18));else map.setView([53.5511,9.9937],11);
}
async function coordsForRoute(){const pts=[];if($("useStart").checked&&start)pts.push(start);stops.forEach(s=>pts.push({lat:s.lat,lon:s.lon}));return pts}
async function calculateRoute(){
 try{
 const pts=await coordsForRoute();if(pts.length<2)return;
 const coord=pts.map(p=>`${p.lon},${p.lat}`).join(";");
 const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${coord}?overview=full&geometries=geojson`);
 if(!r.ok)throw Error();const d=await r.json();if(d.code!=="Ok")throw Error();
 const route=d.routes[0];routeLayer=L.geoJSON(route.geometry,{style:{color:"#087cff",weight:5,opacity:.8}}).addTo(map);
 $("distance").textContent=(route.distance/1000).toFixed(1)+" km";$("duration").textContent=Math.round(route.duration/60)+" min";
 }catch(e){/* map pins remain useful if routing service is unavailable */}
}
$("locate").onclick=()=>{
 if(!navigator.geolocation){msg("Standort wird von diesem Browser nicht unterstützt.");return}
 msg("Standort wird ermittelt …");
 navigator.geolocation.getCurrentPosition(p=>{start={lat:p.coords.latitude,lon:p.coords.longitude};drawMap();if(stops.length)calculateRoute();msg("Standort als Startpunkt gesetzt.");},()=>msg("Standortzugriff nicht möglich. Bitte in iOS erlauben."),{enableHighAccuracy:true,timeout:12000});
};
$("useStart").onchange=()=>{if(stops.length)render()};
$("optimize").onclick=async()=>{
 if(stops.length<3){msg("Zum Optimieren bitte mindestens drei Ziele eingeben.");return}
 $("optimize").disabled=true;msg("Berechne eine möglichst kurze Reihenfolge …");
 try{
  const pts=await coordsForRoute();const coord=pts.map(p=>`${p.lon},${p.lat}`).join(";");
  const r=await fetch(`https://router.project-osrm.org/table/v1/driving/${coord}?annotations=duration`);
  if(!r.ok)throw Error();const d=await r.json();if(d.code!=="Ok")throw Error();
  const offset=pts.length-stops.length, matrix=d.durations;
  let remaining=stops.map((_,i)=>i+offset), order=[], current=0;
  if(offset===0){current=remaining.shift();order.push(current)}
  while(remaining.length){let best=remaining[0],bestCost=Infinity;for(const j of remaining){const c=matrix[current][j];if(c!==null&&c<bestCost){best=j;bestCost=c}}order.push(best);remaining=remaining.filter(x=>x!==best);current=best}
  // If current location is start, order contains only stop indices.
  if(offset===1)order=order.map(x=>x-offset);
  stops=order.map(i=>stops[i]);save();render();msg("Reihenfolge nach geschätzter Fahrzeit optimiert.");
 }catch(e){msg("Optimierung gerade nicht verfügbar. Bitte später erneut versuchen.")}finally{$("optimize").disabled=false}
};
function mapsUrl(list){
 if(!list.length)return "";
 let url="https://maps.apple.com/?dirflg=d&daddr="+encodeURIComponent(list[0].query);
 if(start&&$("useStart").checked)url+="&saddr="+encodeURIComponent(`${start.lat},${start.lon}`);
 return url;
}
$("allMaps").onclick=()=>{if(stops.length)location.href=mapsUrl(stops)};
$("next").onclick=()=>{if(stops.length){const s=stops[0];location.href="https://maps.apple.com/?daddr="+encodeURIComponent(s.query)+"&dirflg=d"}};
$("clear").onclick=()=>{if(confirm("Alle gespeicherten Ziele löschen?")){stops=[];save();render();msg("Alle Ziele gelöscht.")}};
if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(()=>{});
render();
