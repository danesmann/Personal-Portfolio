/* Infinite WebGL card-grid — mount/dispose so it survives SPA navigation
   without leaking WebGL contexts, rAF loops, listeners or intervals.
   Exposes window.__remountGrid() and window.__disposeGrid().            */
(function(){
  var state = null;

  window.__disposeGrid = function(){
    if(state){ try { state.dispose(); } catch(e){} state = null; }
  };

  window.__remountGrid = function(){
    window.__disposeGrid();
    var section = document.getElementById('gridhero');
    var canvas  = document.getElementById('gridCanvas');
    if(!section || !canvas || !window.THREE) return;

    var ac = new AbortController(), sig = ac.signal;
    var opt = { signal: sig }, optP = { passive: true, signal: sig };
    var rafId = 0, accentInt = 0, io = null, probe = null, renderer = null, disposed = false;
    var navEl = document.querySelector('nav');

    var CARDS = [
      {n:'Lubylab',          c:'Product · Branding · Marketing', y:'2026', img:'mqat8jvs-image.png'},
      {n:'Born In Red',      c:'Photography · Story Telling',    y:'2025', img:'mqapvoij-image.png'},
      {n:'Fae Beauty',       c:'Branding · Marketing',           y:'2025', img:'mqapt6sv-image.png'},
      {n:'Lucky Money',      c:'Illustration · Merch',           y:'2025', img:'mqapbk31-image.png'},
      {n:'Celavie',          c:'Brand System · Product',         y:'2024', img:'mqansfkf-image.png'},
      {n:'Merit Christmas',  c:'Illustration · Charity',         y:'2024', img:'mqam66yh-image.png'},
      {n:'Mandala Hotel',    c:'Branding · Illustration',        y:'2023', img:'mqam5heg-image.png'},
      {n:'TEDxBUV',          c:'Website · Social',               y:'2023', img:'mqam0tkj-image.png'},
      {n:'Photography',      c:'Personal Series',                y:'2024', img:'mqalzjp6-image.png'},
      {n:'Academic Research',c:'Environmental Eng.',             y:'2023', img:'mqal6g6n-image.png'},
      {n:'AI Art',           c:'Generative',                     y:'2025', img:'mqakzst8-image.png'},
      {n:'3D Objects',       c:'Modeling · Render',              y:'2025', img:'mqakltaw-image.png'}
    ];
    var COLS=4, ROWS=3, CW=512, CH=512;

    var atlas=document.createElement('canvas'); atlas.width=COLS*CW; atlas.height=ROWS*CH;
    var actx=atlas.getContext('2d');
    function coverDraw(ctx,img,x,y,w,h){
      var ir=img.width/img.height, r=w/h, sw,sh,sx,sy;
      if(ir>r){ sh=img.height; sw=sh*r; sx=(img.width-sw)/2; sy=0; }
      else{ sw=img.width; sh=sw/r; sx=0; sy=(img.height-sh)/2; }
      ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);
    }
    function cell(i,img){
      var col=i%COLS, row=Math.floor(i/COLS), ox=col*CW, oy=row*CH, d=CARDS[i];
      actx.clearRect(ox,oy,CW,CH);   // transparent bg: cell background is composited in the shader
      var S=360, ix=ox+(CW-S)/2, iy=oy+(CH-S)/2;
      actx.fillStyle='#151517'; actx.fillRect(ix,iy,S,S);
      if(img){ actx.save(); actx.beginPath(); actx.rect(ix,iy,S,S); actx.clip();
        coverDraw(actx,img,ix,iy,S,S); actx.restore(); }
      actx.textBaseline='alphabetic';
      actx.fillStyle='#e7e6e2'; actx.font='400 23px "Pretendard", system-ui, sans-serif';
      actx.textAlign='left';  actx.fillText(d.n, ox+26, oy+46);
      actx.textAlign='right'; actx.fillText(d.y, ox+CW-26, oy+46);
      actx.textAlign='left';  actx.fillText(d.c, ox+26, oy+CH-26);
      actx.textAlign='left';
      actx.fillStyle='rgba(255,255,255,0.10)';
      actx.fillRect(ox,oy,CW,1.4);
      actx.fillRect(ox,oy,1.4,CH);
    }
    var imgs=[];
    for(var i=0;i<12;i++) cell(i,null);
    var tex=new THREE.CanvasTexture(atlas);
    tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
    tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter; tex.generateMipmaps=false;
    if(THREE.sRGBEncoding!==undefined) tex.encoding=THREE.sRGBEncoding;
    CARDS.forEach(function(d,idx){ var im=new Image();
      im.onload=function(){ imgs[idx]=im; cell(idx,im); tex.needsUpdate=true; }; im.src=d.img; });

    renderer=new THREE.WebGLRenderer({canvas:canvas, antialias:true});
    renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
    renderer.setClearColor(0x0a0a0b,1);
    if(THREE.sRGBEncoding!==undefined) renderer.outputEncoding=THREE.sRGBEncoding;
    var D=10, OVER=1.5;
    var camera=new THREE.PerspectiveCamera(42,1,0.1,100); camera.position.z=D;
    var scene=new THREE.Scene();
    var geo=new THREE.PlaneGeometry(1,1,60,60);
    var uni={ uAtlas:{value:tex}, uOffset:{value:new THREE.Vector2(0,0)},
              uRepeat:{value:new THREE.Vector2(2,2)}, uCurve:{value:0}, uHoverCell:{value:new THREE.Vector2(1e6,1e6)}, uAccent:{value:new THREE.Vector3(0.17,0.41,1.0)} };
    var mat=new THREE.ShaderMaterial({ uniforms:uni,
      vertexShader:
        'varying vec2 vUv; uniform float uCurve;'+
        'void main(){ vUv=uv; vec3 p=position; vec2 c=uv*2.0-1.0;'+
        ' p.z -= uCurve*dot(c,c);'+
        ' gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
      fragmentShader:
        'precision highp float; varying vec2 vUv; uniform sampler2D uAtlas;'+
        'uniform vec2 uOffset; uniform vec2 uRepeat; uniform float uCurve; uniform vec2 uHoverCell; uniform vec3 uAccent;'+
        'void main(){ vec2 cl=vUv*uRepeat+uOffset; vec4 t=texture2D(uAtlas, fract(cl));'+
        ' vec2 tile=floor(cl*vec2(4.0,3.0)); vec3 bg=vec3(0.043,0.043,0.047);'+
        ' if(abs(tile.x-uHoverCell.x)<0.5 && abs(tile.y-uHoverCell.y)<0.5){ bg=uAccent; }'+
        ' vec3 col=mix(bg, t.rgb, t.a);'+
        ' vec2 c=vUv*2.0-1.0; float vig=smoothstep(1.55,0.45,length(c));'+
        ' col*=mix(1.0,vig, clamp(uCurve*0.85,0.0,0.82));'+
        ' gl_FragColor=vec4(col,1.0); }' });
    var mesh=new THREE.Mesh(geo,mat); scene.add(mesh);

    var Wc=1,Hc=1,baseRX=2,baseRY=2,repX=2,repY=2;
    function layout(){
      Wc=section.clientWidth||1; Hc=section.clientHeight||1;
      renderer.setSize(Wc,Hc,false);
      camera.aspect=Wc/Hc; camera.updateProjectionMatrix();
      var tanH=Math.tan(camera.fov*Math.PI/360);
      var viewH=2*D*tanH, viewW=viewH*camera.aspect;
      mesh.scale.set(viewW*OVER, viewH*OVER, 1);
      var cellsX = camera.aspect<0.9 ? 4 : (camera.aspect<1.5?6:7);
      var cellAspect=CW/CH;
      var cellWv=viewW/cellsX, cellHv=cellWv/cellAspect, rowsV=viewH/cellHv;
      baseRX=(cellsX*OVER)/COLS; baseRY=(rowsV*OVER)/ROWS;
    }
    layout();

    var off={x:0,y:0}, mom={x:0,y:0}, dragging=false, held=false, lx=0, ly=0, live=0;
    var curve=0, zoom=1, prevRX=baseRX*1, prevRY=baseRY*1;
    function down(e){ dragging=true; held=true; section.classList.add('grabbing'); lx=e.clientX; ly=e.clientY; mom.x=mom.y=0;
      try{ canvas.setPointerCapture(e.pointerId); }catch(_){ } }
    function move(e){
      if(!dragging) return;
      var dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY;
      var ox=-dx/Wc*repX, oy=dy/Hc*repY;
      off.x+=ox; off.y+=oy; mom.x=ox; mom.y=oy;
      var ms=Math.hypot(mom.x,mom.y); if(ms>MAXSPEED){ mom.x*=MAXSPEED/ms; mom.y*=MAXSPEED/ms; }
      live=Math.hypot(mom.x,mom.y);
    }
    function up(){ dragging=false; held=false; section.classList.remove('grabbing'); }
    canvas.addEventListener('pointerdown',down,opt);
    window.addEventListener('pointermove',move,opt);
    window.addEventListener('pointerup',up,opt);
    var pIn=false, ppx=0, ppy=0;
    canvas.addEventListener('pointerenter',function(){ pIn=true; },opt);
    canvas.addEventListener('pointerleave',function(){ pIn=false; },opt);
    canvas.addEventListener('pointermove',function(e){ ppx=e.clientX; ppy=e.clientY; },opt);

    var visible=true;
    if('IntersectionObserver' in window){
      io=new IntersectionObserver(function(es){ visible=es[0].isIntersecting; },{threshold:0.01});
      io.observe(section);
    }
    var MAXCURVE=1.6, MAXZOOM=0.12, MAXSPEED=0.05;
    function frame(){
      if(disposed) return;
      rafId=requestAnimationFrame(frame);
      if(!visible) return;
      if(!dragging){ off.x+=mom.x; off.y+=mom.y; mom.x*=0.91; mom.y*=0.91;
        if(Math.abs(mom.x)<1e-6)mom.x=0; if(Math.abs(mom.y)<1e-6)mom.y=0; }
      var sp = dragging? live : Math.hypot(mom.x,mom.y);
      live*=0.85;
      var curveT = held ? MAXCURVE : 0, zoomT = held ? (1+MAXZOOM) : 1;
      curve+=(curveT-curve)*0.08; zoom+=(zoomT-zoom)*0.08;
      repX=baseRX*zoom; repY=baseRY*zoom;
      off.x+=0.5*(prevRX-repX); off.y+=0.5*(prevRY-repY);
      prevRX=repX; prevRY=repY;
      uni.uOffset.value.set(off.x,off.y);
      uni.uRepeat.value.set(repX,repY);
      uni.uCurve.value=curve;
      if(pIn && !dragging){
        var rc=canvas.getBoundingClientRect();
        var sx=(ppx-rc.left)/(rc.width||1), sy=(ppy-rc.top)/(rc.height||1);
        var pu=0.5+(sx-0.5)/OVER, pv=0.5+((1.0-sy)-0.5)/OVER;
        uni.uHoverCell.value.set(Math.floor((pu*repX+off.x)*COLS), Math.floor((pv*repY+off.y)*ROWS));
      } else { uni.uHoverCell.value.set(1e6,1e6); }
      renderer.render(scene,camera);
    }
    rafId=requestAnimationFrame(frame);

    window.addEventListener('resize',function(){ var z=zoom; layout(); prevRX=baseRX*z; prevRY=baseRY*z; },opt);
    var reveal=function(){ section.classList.add('ready'); };
    if(document.fonts&&document.fonts.ready){ document.fonts.ready.then(function(){ if(disposed) return; for(var k=0;k<12;k++) cell(k, imgs[k]); tex.needsUpdate=true; reveal(); }); } else reveal();
    setTimeout(function(){ if(!disposed) reveal(); },400);
    function navState(){ if(!navEl) return; var r=section.getBoundingClientRect(); var nh=navEl.offsetHeight||64; navEl.classList.toggle('over-grid', r.bottom>nh+4); }
    navState(); window.addEventListener('scroll',navState,optP); window.addEventListener('resize',navState,opt);
    probe=document.createElement('span'); probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none'; document.body.appendChild(probe);
    function readAccent(){ var v=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); probe.style.color=v||'#2b69ff'; var m=getComputedStyle(probe).color.match(/[0-9.]+/g); if(m&&m.length>=3) uni.uAccent.value.set(m[0]/255,m[1]/255,m[2]/255); }
    readAccent(); accentInt=setInterval(readAccent,400);

    state = { dispose: function(){
      disposed = true;
      ac.abort();
      if(rafId) cancelAnimationFrame(rafId);
      if(accentInt) clearInterval(accentInt);
      if(io) io.disconnect();
      if(probe && probe.parentNode) probe.parentNode.removeChild(probe);
      if(navEl) navEl.classList.remove('over-grid');
      if(renderer){ try{ renderer.dispose(); }catch(e){} try{ renderer.forceContextLoss(); }catch(e){} }
    }};
  };

  // auto-mount on a direct (non-SPA) load of the home page
  function boot(){
    if(window.__spaWillMount) return;   // router (spa.js) will mount instead
    if(!document.getElementById('gridCanvas')) return;
    if(window.THREE){ window.__remountGrid(); return; }
    var t=setInterval(function(){ if(window.THREE){ clearInterval(t); window.__remountGrid(); } },50);
    setTimeout(function(){ clearInterval(t); },6000);
  }
  if(document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
