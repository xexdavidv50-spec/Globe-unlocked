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

  function normLon(lon){let l=lon;while(l>180)l-=360;while(l<-180)l+=360;return l;}

  function clipEdge(ring,edge,keepGreater){
    if(!ring||ring.length<2)return [];
    const inside=p=>{const l=normLon(p[0]);return keepGreater?l>=edge-1e-8:l<=edge+1e-8;};
    const hit=(a,b)=>{
      let la=normLon(a[0]), lb=normLon(b[0]);
      if(lb-la>180)la+=360;else if(la-lb>180)lb+=360;
      let e=edge;
      if((la>180||lb>180)&&e<=0)e+=360;
      const t=Math.max(0,Math.min(1,(e-la)/(lb-la||1e-12)));
      return [normLon(edge), a[1]+(b[1]-a[1])*t];
    };
    const out=[];
    for(let i=0;i<ring.length-1;i++){
      const a=ring[i], b=ring[i+1], ain=inside(a), bin=inside(b);
      if(ain&&bin)out.push([normLon(a[0]),a[1]]);
      else if(ain&&!bin){out.push([normLon(a[0]),a[1]]);out.push(hit(a,b));}
      else if(!ain&&bin)out.push(hit(a,b));
    }
    return out;
  }

  function slab(geometry,minL,maxL){
    if(!(maxL>minL)||minL<-180||maxL>180)return null;
    const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const out=[];
    for(let p=0;p<polys.length;p++){
      const rings=[];
      const poly=polys[p];
      for(let r=0;r<poly.length;r++){
        let pts=clipEdge(poly[r],minL,true);
        if(pts.length>1)pts=pts.concat([pts[0]]);
        pts=clipEdge(pts,maxL,false);
        if(!pts.length)continue;
        if(pts[0][0]!==pts[pts.length-1][0]||pts[0][1]!==pts[pts.length-1][1])pts.push(pts[0].slice());
        if(pts.length>=4)rings.push(pts);
      }
      if(rings.length)out.push(rings);
    }
    return out.length?{type:'MultiPolygon',coordinates:out}:null;
  }

  function messyInside(d,limit,width,height){
    const tokens=String(d).split(/(?=[MLZ])/);
    let prev=null;
    for(let t=0;t<tokens.length;t++){
      const tok=tokens[t];
      if(!tok)continue;
      if(tok.charAt(0)==='Z'){prev=null;continue;}
      const re=/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
      let m;
      while((m=re.exec(tok))){
        const pt=[+m[1],+m[2]];
        if(prev){
          const dist=Math.hypot(pt[0]-prev[0],pt[1]-prev[1]);
          const inside=function(p){return p[0]>-30&&p[0]<width+30&&p[1]>-30&&p[1]<height+30;};
          if(dist>limit&&(inside(prev)||inside(pt)))return true;
        }
        prev=pt;
      }
    }
    return false;
  }

  function calmGeometry(d3,path,geometry,anchorLon,width,height){
    const limit=Math.min(width,height)*0.42;
    let d=path(geometry);
    if(!d||!messyInside(d,limit,width,height))return geometry;
    if(!(anchorLon>-140&&anchorLon<150))return geometry;
    const clipped=slab(geometry,anchorLon-18,anchorLon+32);
    if(!clipped)return geometry;
    d=path(clipped);
    if(!d||messyInside(d,limit,width,height))return geometry;
    return clipped;
  }

  function projectionFor(d3,continent,width,height,features,countries){
    const extent=[[16,16],[width-72,height-72]];
    if(!continent){
      const p=d3.geoEqualEarth();
      p.fitExtent([[8,8],[width-8,height-62]],{type:'Sphere'});
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

  function box(w,s,e,n){
    return {type:'Polygon',coordinates:[[[w,s],[w,n],[e,n],[e,s],[w,s]]]};
  }

  function mount(opts){
    const slot=opts.slot;
    const gen=String(Math.random());
    slot.innerHTML=`<div class="mapwrap${opts.tall?' tall':''}" data-gen="${gen}"><svg role="group" aria-label="${opts.continent?opts.continent+' map':'World map'}"></svg><div class="hoverlab" hidden></div><div class="pickbar" hidden><div><strong></strong><small></small></div><button type="button" class="pickgo">Start quiz</button></div><div class="zoombar"><button type="button" class="zin" aria-label="Zoom in">+</button><button type="button" class="zout" aria-label="Zoom out">−</button><button type="button" class="zreset" aria-label="Reset view">↺</button></div></div><p class="mapnote"><span class="sw lock"></span>Locked<span class="sw open"></span>Unlocked. Tap a country, then Start quiz. Pinch or drag to look closer. Dots mark small countries.</p>`;
    const note=slot.querySelector('.mapnote');
    const wrap=slot.querySelector('.mapwrap');
    const stop=function(e){e.preventDefault();};
    wrap.addEventListener('touchmove',stop,{passive:false});
    wrap.addEventListener('gesturestart',stop,{passive:false});
    wrap.addEventListener('gesturechange',stop,{passive:false});
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
    if(path.digits)path.digits(1);
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
    function rankText(id){
      const r=opts.rank?opts.rank(id):'';
      if(r==='easy')return 'Best: Easy';
      if(r==='medium')return 'Best: Medium';
      if(r==='hard')return 'Best: Hard';
      return 'Locked';
    }

    features.forEach(f=>{
      if(!f.geometry)return;
      const country=f.id?byId[f.id]:null;
      const anchor=country?country.latlng[1]:0;
      const geom=f.id?calmGeometry(d3,path,f.geometry,anchor,width,height):f.geometry;
      const d=path(geom);
      if(!d||(f.id&&messyInside(d,Math.min(width,height)*0.42,width,height)))return;
      const el=document.createElementNS(ns,'path');
      el.setAttribute('d',d);
      el.setAttribute('fill',f.id?fillFor(f.id):'rgba(255,255,255,.13)');
      el.setAttribute('stroke',f.id?'rgba(11,29,58,.65)':'rgba(255,255,255,.18)');
      el.setAttribute('stroke-width',f.id?'1':'0.6');
      if(f.id){
        el.dataset.id=f.id;
        el.setAttribute('role','button');
        el.setAttribute('aria-label',(country?country.name:f.name)+', '+rankText(f.id));
        const title=document.createElementNS(ns,'title');
        title.textContent=country?country.name:f.name;
        el.appendChild(title);
      }else{
        el.setAttribute('pointer-events','none');
      }
      viewport.appendChild(el);
    });

    const seen=new Set();
    features.forEach(f=>{if(f.id)seen.add(f.id)});
    const pinList=[];
    const pinBelow=opts.continent?4:2.2;
    opts.countries.forEach(c=>{
      let tiny=!seen.has(c.id), size=0;
      if(!tiny){
        const feat=features.find(f=>f.id===c.id);
        if(feat&&feat.geometry){
          const geom=calmGeometry(d3,path,feat.geometry,c.latlng[1],width,height);
          const b=path.bounds(geom);
          const bw=b[1][0]-b[0][0], bh=b[1][1]-b[0][1];
          size=Math.max(bw,bh);
          tiny=!isFinite(size)||size<pinBelow;
        }
      }
      if(!tiny)return;
      const xy=projection([c.latlng[1],c.latlng[0]]);
      if(!xy||!isFinite(xy[0])||!isFinite(xy[1]))return;
      if(xy[0]<-20||xy[1]<-20||xy[0]>width+20||xy[1]>height+20)return;
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
      g.setAttribute('aria-label',c.name+' marker, '+rankText(c.id));
      const hit=document.createElementNS(ns,'circle');
      hit.setAttribute('class','pin-hit');
      hit.setAttribute('r','8');
      hit.dataset.id=c.id;
      const dot=document.createElementNS(ns,'circle');
      dot.setAttribute('r','4.5');
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
    const pickbar=wrap.querySelector('.pickbar');
    const hover=wrap.querySelector('.hoverlab');
    let selected=null;

    function clampPan(){
      const slack=48;
      const minX=width-width*k-slack, maxX=slack;
      const minY=height-height*k-slack, maxY=slack;
      tx=Math.max(minX,Math.min(maxX,tx));
      ty=Math.max(minY,Math.min(maxY,ty));
    }
    function apply(){
      viewport.setAttribute('transform',`translate(${tx} ${ty}) scale(${k})`);
      const zoomed=k>=2.2;
      const hitR=zoomed?13:(opts.continent?8:5);
      viewport.querySelectorAll('.pin').forEach(p=>{
        p.setAttribute('transform',`translate(${p.dataset.x} ${p.dataset.y}) scale(${1/k})`);
        const quiet=!opts.continent&&!zoomed;
        p.style.pointerEvents=quiet?'none':'auto';
        const circles=p.querySelectorAll('circle');
        circles.forEach(el=>{el.style.pointerEvents=quiet?'none':'auto';});
        const hit=p.querySelector('.pin-hit');
        if(hit)hit.setAttribute('r',String(hitR));
        const dot=circles[1];
        if(dot)dot.setAttribute('r',zoomed?'5':(opts.continent?'4.5':'2.5'));
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
    function paintSelect(){
      viewport.querySelectorAll('path[data-id]').forEach(p=>{
        const on=p.dataset.id===selected;
        p.setAttribute('stroke',on?'#ffd166':'rgba(11,29,58,.65)');
        p.setAttribute('stroke-width',on?'3':'1');
      });
      viewport.querySelectorAll('.pin').forEach(p=>p.classList.toggle('on',p.dataset.id===selected));
    }
    function select(id){
      const c=byId[id];
      if(!c)return;
      selected=id;
      paintSelect();
      pickbar.hidden=false;
      hover.hidden=true;
      pickbar.querySelector('strong').textContent=c.name;
      pickbar.querySelector('small').textContent=rankText(id);
    }
    function clearSelect(){
      selected=null;
      paintSelect();
      pickbar.hidden=true;
    }
    pickbar.querySelector('.pickgo').onclick=function(){if(selected&&opts.onPick)opts.onPick(selected);};
    apply();

    function localPoint(e){
      const r=svg.getBoundingClientRect();
      const sx=r.width||width, sy=r.height||height;
      return {x:(e.clientX-r.left)*width/sx, y:(e.clientY-r.top)*height/sy, cx:e.clientX, cy:e.clientY};
    }
    svg.addEventListener('pointerdown',e=>{
      if(e.button!=null&&e.button!==0)return;
      try{svg.setPointerCapture(e.pointerId)}catch(err){}
      const pt=localPoint(e);
      pointers.set(e.pointerId,pt);
      moved=false;
      hover.hidden=true;
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
      if(!pointers.has(e.pointerId)){
        if(pointers.size===0&&e.pointerType==='mouse'){
          const hit=document.elementFromPoint(e.clientX,e.clientY);
          const node=hit&&hit.closest&&hit.closest('[data-id]');
          if(node&&byId[node.dataset.id]&&node.dataset.id!==selected&&pickbar.hidden){
            hover.hidden=false;
            hover.textContent=byId[node.dataset.id].name;
          }else hover.hidden=true;
        }
        return;
      }
      if(e.cancelable)e.preventDefault();
      const pt=localPoint(e);
      pointers.set(e.pointerId,pt);
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
          if(node&&node.dataset.id&&byId[node.dataset.id])select(node.dataset.id);
          else clearSelect();
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
    svg.addEventListener('wheel',function(e){
      e.preventDefault();
      const pt=localPoint(e);
      zoomAt(pt,k*(e.deltaY<0?1.18:1/1.18));
    },{passive:false});

    slot.querySelector('.zin').onclick=()=>zoomAt(center(),k*1.6);
    slot.querySelector('.zout').onclick=()=>zoomAt(center(),k/1.6);
    slot.querySelector('.zreset').onclick=()=>{k=1;tx=0;ty=0;apply()};
    svg.dataset.ready='1';
  }

  function card(el,id){
    if(!el)return;
    const gen=String(Math.random());
    el.dataset.gen=gen;
    el.innerHTML='<svg aria-hidden="true"></svg>';
    load().then(()=>{
      if(el.dataset.gen!==gen)return;
      drawCard(el,id);
    }).catch(()=>{});
  }

  function drawCard(el,id){
    const d3=window.GeoDraw.d3;
    const svg=el.querySelector('svg');
    if(!svg)return;
    const width=Math.max(220,Math.round(el.clientWidth||320));
    const height=Math.max(120,Math.round(el.clientHeight||156));
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    svg.setAttribute('pointer-events','none');
    const ns='http://www.w3.org/2000/svg';
    const features=prepare(d3);
    const country=(window.GEO||[]).find(c=>c.id===id);
    const anchor=country?[country.latlng[1],country.latlng[0]]:[0,0];
    const target=features.find(f=>f.id===id);
    const geometry=target&&target.geometry;
    const area=geometry?Math.abs(d3.geoArea({type:'Feature',geometry})):0;
    const micro=!geometry||area<8e-5;
    const extent=[[14,14],[width-14,height-14]];
    let projection;
    if(id==='ATA'){
      projection=d3.geoStereographic().rotate([0,90]);
      safeFit(projection,extent,geometry?{type:'Feature',properties:{},geometry}:{type:'Sphere'},{type:'Sphere'});
    }else if(id==='RUS'){
      projection=d3.geoMercator().rotate([-90,0]);
      const clipped=slab(geometry,30,170)||{type:'Point',coordinates:anchor};
      safeFit(projection,extent,clipped,{type:'Point',coordinates:anchor});
    }else{
      const rot=anchor[0];
      projection=d3.geoMercator().rotate([-rot,0]);
      let fitObj;
      if(micro){
        const span=id==='TUV'||!geometry?10:8;
        fitObj=box(anchor[0]-span,Math.max(-75,anchor[1]-span*0.7),anchor[0]+span,Math.min(78,anchor[1]+span*0.7));
      }else{
        const b=d3.geoBounds({type:'Feature',geometry});
        let west=b[0][0], south=b[0][1], east=b[1][0], north=b[1][1];
        if(east<west){
          fitObj=box(anchor[0]-18,anchor[1]-12,anchor[0]+18,anchor[1]+12);
        }else{
          const lonSpan=Math.max(0.4,east-west), latSpan=Math.max(0.4,north-south);
          const padL=Math.max(lonSpan*0.22, lonSpan<20?3.5:1.2);
          const padB=Math.max(latSpan*0.22, latSpan<16?2.8:1);
          fitObj=box(west-padL,Math.max(-75,south-padB),east+padL,Math.min(80,north+padB));
        }
      }
      safeFit(projection,extent,fitObj,{type:'Point',coordinates:anchor});
    }
    const path=d3.geoPath(projection);
    if(path.digits)path.digits(1);
    const ocean=document.createElementNS(ns,'rect');
    ocean.setAttribute('x','0');ocean.setAttribute('y','0');ocean.setAttribute('width',String(width));ocean.setAttribute('height',String(height));
    ocean.setAttribute('fill','#0e3a5c');
    svg.appendChild(ocean);
    features.forEach(f=>{
      if(!f.geometry||f.id===id)return;
      const cen=d3.geoCentroid({type:'Feature',geometry:f.geometry});
      if(!isFinite(cen[0])||d3.geoDistance(cen,anchor)>0.55)return;
      const geom=calmGeometry(d3,path,f.geometry,f.id&&window.GEO?((window.GEO.find(c=>c.id===f.id)||{}).latlng||[0,anchor[0]])[1]:anchor[0],width,height);
      const d=path(geom);
      if(!d||messyInside(d,Math.min(width,height)*0.5,width,height))return;
      const elp=document.createElementNS(ns,'path');
      elp.setAttribute('d',d);
      elp.setAttribute('fill','rgba(255,255,255,.28)');
      elp.setAttribute('stroke','rgba(11,29,58,.4)');
      elp.setAttribute('stroke-width','0.6');
      svg.appendChild(elp);
    });
    let drew=false, tiny=micro;
    if(geometry&&id!=='RUS'){
      const d=path(geometry);
      if(d&&!messyInside(d,Math.min(width,height)*0.5,width,height)){
        const b=path.bounds(geometry);
        const size=Math.max(b[1][0]-b[0][0], b[1][1]-b[0][1]);
        if(isFinite(size)&&size<8)tiny=true;
        const elp=document.createElementNS(ns,'path');
        elp.setAttribute('d',d);
        elp.setAttribute('fill','#ffd166');
        elp.setAttribute('stroke','#fff');
        elp.setAttribute('stroke-width','1.4');
        svg.appendChild(elp);
        drew=true;
      }
    }else if(geometry&&id==='RUS'){
      const clipped=slab(geometry,30,170);
      const d=clipped&&path(clipped);
      if(d){
        const elp=document.createElementNS(ns,'path');
        elp.setAttribute('d',d);
        elp.setAttribute('fill','#ffd166');
        elp.setAttribute('stroke','#fff');
        elp.setAttribute('stroke-width','1.2');
        svg.appendChild(elp);
        drew=true;
      }
    }
    if(tiny||!drew){
      const xy=projection(anchor);
      if(xy&&isFinite(xy[0])&&isFinite(xy[1])){
        const ring=document.createElementNS(ns,'circle');
        ring.setAttribute('cx',String(xy[0]));
        ring.setAttribute('cy',String(xy[1]));
        ring.setAttribute('r','16');
        ring.setAttribute('fill','rgba(255,209,102,.25)');
        ring.setAttribute('stroke','#ffd166');
        ring.setAttribute('stroke-width','3');
        const dot=document.createElementNS(ns,'circle');
        dot.setAttribute('cx',String(xy[0]));
        dot.setAttribute('cy',String(xy[1]));
        dot.setAttribute('r','5');
        dot.setAttribute('fill','#ffd166');
        dot.setAttribute('stroke','#fff');
        dot.setAttribute('stroke-width','2');
        svg.appendChild(ring);svg.appendChild(dot);
      }
    }
  }

  window.GeoMap={mount,load,card};
})();
