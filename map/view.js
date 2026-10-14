// Country shapes: Natural Earth 50m (public domain), packaged by world-atlas.
(function(){
  const KEEP=45*Math.PI/180;
  let world, ids, prepared, loading;

  function load(){
    if(world&&ids)return Promise.resolve();
    if(!loading){
      loading=Promise.all([
        fetch('map/countries-50m.json').then(r=>{if(!r.ok)throw new Error('map');return r.json()}),
        fetch('map/ids.json').then(r=>{if(!r.ok)throw new Error('ids');return r.json()})
      ]).then(pair=>{world=pair[0];ids=pair[1]});
    }
    return loading;
  }

  function keepNear(d3,feature){
    const geom=feature.geometry;
    if(!geom)return null;
    const polys=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates;
    if(polys.length<2)return geom;
    let best=0,bestA=-1;
    for(let i=0;i<polys.length;i++){
      const a=Math.abs(d3.geoArea({type:'Polygon',coordinates:polys[i]}));
      if(a>bestA){bestA=a;best=i}
    }
    const main=d3.geoCentroid({type:'Polygon',coordinates:polys[best]});
    const kept=[];
    for(let i=0;i<polys.length;i++){
      if(i===best||d3.geoDistance(main,d3.geoCentroid({type:'Polygon',coordinates:polys[i]}))<=KEEP)kept.push(polys[i]);
    }
    return kept.length===1?{type:'Polygon',coordinates:kept[0]}:{type:'MultiPolygon',coordinates:kept};
  }

  function prepare(d3){
    if(prepared)return prepared;
    const fc=window.GeoDraw.topojson.feature(world,world.objects.countries);
    prepared=fc.features.map(f=>({id:ids[f.properties.name]||null,name:f.properties.name,geometry:keepNear(d3,f)}));
    return prepared;
  }

  function safeFit(projection,extent,object,fallback){
    try{
      projection.fitExtent(extent,object);
      if(!isFinite(projection.scale())||projection.scale()<=1)throw new Error('scale');
    }catch(e){
      projection.fitExtent(extent,fallback);
    }
  }

  function projectionFor(d3,continent,width,height,features,countries){
    const extent=[[16,16],[width-72,height-72]];
    if(!continent){
      const p=d3.geoEqualEarth();
      p.fitExtent(extent,{type:'Sphere'});
      return p;
    }
    if(continent==='Antarctica'){
      const p=d3.geoStereographic().rotate([0,90]);
      const ata=features.find(f=>f.id==='ATA');
      safeFit(p,extent,ata?{type:'Feature',properties:{},geometry:ata.geometry}:{type:'Sphere'},{type:'Sphere'});
      return p;
    }
    const points={type:'MultiPoint',coordinates:countries.map(c=>[c.latlng[1],c.latlng[0]])};
    if(continent==='Oceania'){
      const p=d3.geoMercator().rotate([-160,0]);
      const geoms=features.filter(f=>f.id&&f.geometry).map(f=>f.geometry);
      safeFit(p,extent,{type:'GeometryCollection',geometries:geoms.concat(points.coordinates.map(c=>({type:'Point',coordinates:c})))},points);
      return p;
    }
    const p=d3.geoMercator();
    const geoms=[];
    const byCountry={};
    countries.forEach(c=>{byCountry[c.id]=c});
    features.forEach(f=>{
      if(!f.id||!f.geometry)return;
      const country=byCountry[f.id];
      const anchor=country?[country.latlng[1],country.latlng[0]]:[0,0];
      if(f.id==='RUS'){geoms.push({type:'Point',coordinates:[37.6,55.75]});return}
      const b=d3.geoBounds(f.geometry);
      let span=b[1][0]-b[0][0];
      if(span<0)span+=360;
      geoms.push(span>50?{type:'Point',coordinates:anchor}:f.geometry);
    });
    countries.forEach(c=>{
      if(!features.some(f=>f.id===c.id))geoms.push({type:'Point',coordinates:[c.latlng[1],c.latlng[0]]});
    });
    safeFit(p,extent,{type:'GeometryCollection',geometries:geoms},points);
    return p;
  }

  function mount(opts){
    const slot=opts.slot;
    const gen=String(Math.random());
    slot.innerHTML=`<div class="mapwrap${opts.tall?' tall':''}" data-gen="${gen}"><svg role="group" aria-label="${opts.continent?opts.continent+' map':'World map'}"></svg><div class="zoombar"><button type="button" class="zin" aria-label="Zoom in">+</button><button type="button" class="zout" aria-label="Zoom out">−</button><button type="button" class="zreset" aria-label="Reset view">↺</button></div></div><p class="mapnote"><span class="sw lock"></span>Locked<span class="sw open"></span>Unlocked. Pinch, drag, or use + and −. Dots mark small countries.</p>`;
    const note=slot.querySelector('.mapnote');
    load().then(()=>{
      if(!slot.querySelector(`[data-gen="${gen}"]`))return;
      draw(opts,gen);
    }).catch(()=>{
      if(note)note.textContent='The map could not load. Use the country list.';
      if(opts.onFail)opts.onFail();
    });
  }

  function draw(opts,gen){
    const d3=window.GeoDraw.d3;
    const slot=opts.slot;
    const svg=slot.querySelector('svg');
    const wrap=slot.querySelector('.mapwrap');
    if(!svg||!wrap)return;
    const width=Math.max(280,Math.round(wrap.clientWidth));
    const height=Math.max(240,Math.round(wrap.clientHeight));
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const ns='http://www.w3.org/2000/svg';
    const byId={};
    opts.countries.forEach(c=>{byId[c.id]=c});
    const scope=new Set(opts.countries.map(c=>c.id));
    const features=prepare(d3).filter(f=>!f.id||scope.has(f.id));
    const projection=projectionFor(d3,opts.continent,width,height,features,opts.countries);
    const path=d3.geoPath(projection);
    const viewport=document.createElementNS(ns,'g');
    const bg=document.createElementNS(ns,'rect');
    bg.setAttribute('x','0');bg.setAttribute('y','0');bg.setAttribute('width',String(width));bg.setAttribute('height',String(height));
    bg.setAttribute('fill','transparent');
    svg.appendChild(bg);
    svg.appendChild(viewport);

    function fillFor(id){
      const c=byId[id];
      if(!c)return 'rgba(255,255,255,.16)';
      return opts.done[id]? (opts.colors[c.cont]||'#06d6a0') : '#8d99ab';
    }

    features.forEach(f=>{
      if(!f.geometry)return;
      const d=path(f.geometry);
      if(!d)return;
      const el=document.createElementNS(ns,'path');
      el.setAttribute('d',d);
      el.setAttribute('fill',f.id?fillFor(f.id):'rgba(255,255,255,.13)');
      el.setAttribute('stroke',f.id?'rgba(11,29,58,.65)':'rgba(255,255,255,.18)');
      el.setAttribute('stroke-width',f.id?'1':'0.6');
      if(f.id){
        el.dataset.id=f.id;
        const c=byId[f.id];
        el.setAttribute('role','button');
        el.setAttribute('aria-label',(c?c.name:f.name)+(opts.done[f.id]?' unlocked':' locked'));
        const title=document.createElementNS(ns,'title');
        title.textContent=c?c.name:f.name;
        el.appendChild(title);
      }else{
        el.setAttribute('pointer-events','none');
      }
      viewport.appendChild(el);
    });

    const seen=new Set();
    features.forEach(f=>{if(f.id)seen.add(f.id)});
    const pinList=[];
    opts.countries.forEach(c=>{
      let tiny=!seen.has(c.id), size=0;
      if(!tiny){
        const feat=features.find(f=>f.id===c.id);
        if(feat&&feat.geometry){
          const b=path.bounds(feat.geometry);
          const bw=b[1][0]-b[0][0], bh=b[1][1]-b[0][1];
          size=Math.max(bw,bh);
          tiny=!isFinite(size)||size<8;
        }
      }
      if(!tiny)return;
      const xy=projection([c.latlng[1],c.latlng[0]]);
      if(!xy||!isFinite(xy[0])||!isFinite(xy[1]))return;
      pinList.push({c,x:xy[0],y:xy[1],size});
    });
    pinList.sort((a,b)=>b.size-a.size);
    pinList.forEach(p=>{
      const c=p.c;
      const g=document.createElementNS(ns,'g');
      g.setAttribute('class','pin');
      g.dataset.id=c.id;
      g.dataset.x=String(p.x);
      g.dataset.y=String(p.y);
      g.setAttribute('role','button');
      g.setAttribute('aria-label',c.name+' marker');
      const hit=document.createElementNS(ns,'circle');
      hit.setAttribute('class','pin-hit');
      hit.setAttribute('r','11');
      hit.dataset.id=c.id;
      const dot=document.createElementNS(ns,'circle');
      dot.setAttribute('r','7');
      dot.setAttribute('fill',fillFor(c.id));
      dot.setAttribute('stroke','#fff');
      dot.setAttribute('stroke-width','2');
      dot.dataset.id=c.id;
      const title=document.createElementNS(ns,'title');
      title.textContent=c.name;
      g.appendChild(title);g.appendChild(hit);g.appendChild(dot);
      viewport.appendChild(g);
    });

    let k=1,tx=0,ty=0;
    const pointers=new Map();
    let drag=null,pinch=null,moved=false;

    function clampPan(){
      const slack=48;
      const minX=width-width*k-slack, maxX=slack;
      const minY=height-height*k-slack, maxY=slack;
      tx=Math.max(minX,Math.min(maxX,tx));
      ty=Math.max(minY,Math.min(maxY,ty));
    }
    function apply(){
      viewport.setAttribute('transform',`translate(${tx} ${ty}) scale(${k})`);
      viewport.querySelectorAll('.pin').forEach(p=>{
        p.setAttribute('transform',`translate(${p.dataset.x} ${p.dataset.y}) scale(${1/k})`);
      });
    }
    function zoomAt(mid,nk,origin){
      const base=origin||{k,tx,ty};
      nk=Math.max(1,Math.min(16,nk));
      const x=(mid.x-base.tx)/base.k;
      const y=(mid.y-base.ty)/base.k;
      k=nk;tx=mid.x-x*k;ty=mid.y-y*k;
      clampPan();apply();
    }
    function center(){return {x:width/2,y:height/2}}
    apply();

    svg.addEventListener('pointerdown',e=>{
      if(e.button!=null&&e.button!==0)return;
      try{svg.setPointerCapture(e.pointerId)}catch(err){}
      const r=svg.getBoundingClientRect();
      pointers.set(e.pointerId,{cx:e.clientX,cy:e.clientY,x:e.clientX-r.left,y:e.clientY-r.top});
      moved=false;
      if(pointers.size>=2){
        const arr=[...pointers.values()];
        pinch={dist:Math.hypot(arr[0].x-arr[1].x,arr[0].y-arr[1].y)||1,k,tx,ty,mid:{x:(arr[0].x+arr[1].x)/2,y:(arr[0].y+arr[1].y)/2}};
        drag=null;
      }else{
        pinch=null;
        drag={cx:e.clientX,cy:e.clientY,tx,ty};
      }
    });
    svg.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId))return;
      const r=svg.getBoundingClientRect();
      pointers.set(e.pointerId,{cx:e.clientX,cy:e.clientY,x:e.clientX-r.left,y:e.clientY-r.top});
      if(pointers.size>=2){
        const arr=[...pointers.values()];
        const dist=Math.hypot(arr[0].x-arr[1].x,arr[0].y-arr[1].y)||1;
        const mid={x:(arr[0].x+arr[1].x)/2,y:(arr[0].y+arr[1].y)/2};
        if(!pinch)pinch={dist,k,tx,ty,mid};
        zoomAt(mid,pinch.k*dist/pinch.dist,pinch);
        moved=true;
      }else if(drag){
        const dx=e.clientX-drag.cx, dy=e.clientY-drag.cy;
        if(dx*dx+dy*dy>36)moved=true;
        tx=drag.tx+dx;ty=drag.ty+dy;clampPan();apply();
      }
    });
    function endPointer(e){
      pointers.delete(e.pointerId);
      if(pointers.size===0){
        if(!moved){
          const hit=document.elementFromPoint(e.clientX,e.clientY);
          const node=hit&&hit.closest&&hit.closest('[data-id]');
          if(node&&node.dataset.id&&opts.onPick)opts.onPick(node.dataset.id);
        }
        drag=null;pinch=null;
      }else if(pointers.size===1){
        const rest=[...pointers.values()][0];
        drag={cx:rest.cx,cy:rest.cy,tx,ty};
        pinch=null;
      }
    }
    svg.addEventListener('pointerup',endPointer);
    svg.addEventListener('pointercancel',endPointer);

    slot.querySelector('.zin').onclick=()=>zoomAt(center(),k*1.6);
    slot.querySelector('.zout').onclick=()=>zoomAt(center(),k/1.6);
    slot.querySelector('.zreset').onclick=()=>{k=1;tx=0;ty=0;apply()};
    svg.dataset.ready='1';
  }

  window.GeoMap={mount,load};
})();
