import { residentFootstep, drawResidentLeg, section } from './residentStep.js';

export function installActors(loadArt, loadData) {
  const actors = {loadArt, loadData, cueTime: 0.72};
(() => {
  'use strict';
  const contactTime=.72, touch=[806.42,390.51], seat=502.57, floor=560;
  actors.cueTime=contactTime;
  let native,lighting,face,neck,lids,views,lidParts,preparing,plate,overlap;
  const motion={};
  let tileWidth=64,tileHeight=50,eyeStates,tread,seatMix,seatPhoto;
  // Coordinates in the shared outlines are alternating x/y steps. Store the
  // change from the preceding step on each axis and expand each stroke once.
  function decodeStroke(encoded) {
    const steps=[];
    for(let i=0;i<encoded.length;i++){
      let change=encoded.charCodeAt(i)-64;
      if(encoded[i]==='!') {
        const high=encoded.charCodeAt(++i)-65;
        change=high*16+encoded.charCodeAt(++i)-65;
      }
      const previous=steps[steps.length-2]??0;
      steps.push(((previous+change+128)&255)-128);
    }
    return steps;
  }
  function trace(rings,strokes,points) {
    if(!rings)return null;
    const path=new Path2D();
    for(const [startX,startY,index] of rings) {
      const steps=strokes[index], p=[[startX,startY]];
      let x=startX,y=startY;
      for(let i=0;i<steps.length;i+=2){
        x+=steps[i];y+=steps[i+1];p.push([x,y]);
      }
      if(points)points.push(p);
      path.moveTo(p[0][0],p[0][1]);
      for(let i=0;i<p.length;i++) {
        const a=p[(i-1+p.length)%p.length],b=p[i],c=p[(i+1)%p.length],d=p[(i+2)%p.length];
        const seg=Math.hypot(c[0]-b[0],c[1]-b[1]);
        const c0=.28*seg/Math.max(1,Math.hypot(c[0]-a[0],c[1]-a[1]));
        const c1=.28*seg/Math.max(1,Math.hypot(d[0]-b[0],d[1]-b[1]));
        path.bezierCurveTo(b[0]+(c[0]-a[0])*c0,b[1]+(c[1]-a[1])*c0,
          c[0]-(d[0]-b[0])*c1,c[1]-(d[1]-b[1])*c1,c[0],c[1]);
      }
      path.closePath();
    }
    return path;
  }
  actors.prepareGuest=()=>{
    if(preparing)return preparing;
    preparing=Promise.all([actors.loadArt('base/black.webp'),
    actors.loadArt('guest-part/lighting.webp'),actors.loadArt('guest-part/face.webp'),
    actors.loadArt('guest-part/neck.webp'),actors.loadArt('guest-part/lids.webp'),actors.loadData('guest-part/motion.json')
  ]).then(([n,l,h,m,e,data])=>{
    if(data.texture)[tileWidth,tileHeight]=data.texture;
    eyeStates=data.eyeStates;
    const strokes=data.strokes.map(decodeStroke);
    for(const [name,rows] of Object.entries(data.geometry))motion[name]={frames:rows.map(row=>{
      const [i,ox,oy,w,h,px,py,nx,ny,feet,head,torso,hand]=row;
      const spine=['flinch','watch','recover'].includes(name)?[]:null;
      const coatPath=trace(torso,strokes,spine);
      const rect=data.coatRects?.[i] || [i%10*(tileWidth+2)+1,Math.floor(i/10)*(tileHeight+2)+1,tileWidth,tileHeight];
      return [rect[0],rect[1],w,h,ox,oy,px,py,nx,ny,feet,head,coatPath,trace(hand,strokes),spine?registerHackles(spine,head):null,rect[2],rect[3]];
    })};
    native=n;lighting=l;face=h;neck=m;lids=e;views=data.views;lidParts=data.lids;
    // Register each walk exposure to the sole bearing weight. These distances
    // are measured from the actual pad under the paint, shared by all coats.
    const walk=motion.walk.frames;
    tread=[0];
    walk.forEach((f,i)=>{
      const next=walk[(i+1)%walk.length][10];
      let weight=-1,travel=7;
      for(const [a,,wa] of f[10])for(const [b,,wb] of next){
        const step=b-a,w=Math.min(wa,wb);
        if(step>1&&step<16&&w>weight){weight=w;travel=step;}
      }
      tread.push(tread[i]+travel);
    });
    }).catch(err=>{preparing=null;throw err;});
    return preparing;
  };
  function smallSurface(w,h) {
    const c=document.createElement('canvas');c.width=w;c.height=h;
    return c.getContext('2d');
  }
  function drawCoat(ctx,f,x,y,part) {
    if(!part)return;ctx.save();ctx.translate(x,y);ctx.clip(part,'evenodd');
    ctx.drawImage(lighting,f[0],f[1],f[15],f[16],f[4],f[5],f[2],f[3]);ctx.restore();
  }
  function movingCoat(ctx,f,x,y,part,soleOffset) {
    if(!part||Math.abs(soleOffset)<.02){drawCoat(ctx,f,x,y,part);return;}
    // The body moves continuously between photographed exposures. Interpolate
    // the lower legs in place so a planted pad stays registered to the floor.
    const root=-116, shear=soleOffset/-root;
    ctx.save();ctx.translate(x,y);ctx.transform(1,0,shear,1,-root*shear,0);
    ctx.beginPath();ctx.rect(f[4]-4,root,f[2]+8,180);ctx.clip();
    drawCoat(ctx,f,0,0,part);ctx.restore();
    ctx.save();ctx.translate(x,y);ctx.beginPath();
    ctx.rect(f[4]-4,f[5]-2,f[2]+8,root-f[5]+3);ctx.clip();
    drawCoat(ctx,f,0,0,part);ctx.restore();
  }
  // The five tufts overlap along the rounded ridge. Their tips lean toward
  // the tail. Use the photographed contour of each raised-back pose for roots.
  const hackleLocks=[
    [.417,.129,.030,.022],
    [.501,.146,.046,.027],
    [.616,.168,.060,.035],
    [.748,.141,.050,.025],
    [.856,.103,.032,.018],
  ];
  function registerHackles(rings,head) {
    function ridge(px) {
      let top=Infinity;
      for(const ring of rings){
        let a=ring[ring.length-1];
        for(const b of ring){
          if((a[0]<=px&&b[0]>px)||(b[0]<=px&&a[0]>px))
            top=Math.min(top,a[1]+(b[1]-a[1])*(px-a[0])/(b[0]-a[0]));
          a=b;
        }
      }
      return top;
    }
    const [hx,,width]=head;
    return hackleLocks.map(([u,spread,rise,lean])=>{
      const left=hx+u*width,right=left+spread*width,tip=right+lean*width;
      return {left,right,tip,baseL:ridge(left),baseR:ridge(right),baseTip:ridge(tip),height:rise*width};
    }).filter(hair=>Number.isFinite(hair.baseL+hair.baseR+hair.baseTip));
  }
  function drawHackles(ctx,f,x,y,strength) {
    const locks=f[14];
    if(!locks||strength<=0)return;
    const path=new Path2D();
    let tallest=0;
    for(const {left,right,tip,baseL,baseR,baseTip,height} of locks){
      const lift=height*strength,span=right-left;
      const endX=right+(tip-right)*strength,endY=mix(baseR,baseTip,strength)-lift;
      tallest=Math.max(tallest,lift);
      path.moveTo(left,baseL+3);
      path.bezierCurveTo(left+span*.27,baseL-.12*lift,
        endX-.40*span,endY+.10*lift,endX-.8,endY);
      path.quadraticCurveTo(endX+1.2,endY-.1,endX+.45,endY+1.3);
      path.bezierCurveTo(endX-.08*span,endY+.31*lift,
        right-.10*span,baseR-.26*lift,right+1,baseR+3);
      path.lineTo(right,baseR+10);path.lineTo(left,baseL+10);path.closePath();
    }
    // The coat atlas already extends each opaque edge pixel into the empty
    // margin. Use those original coordinates on both sides of the root so a
    // stripe or pale rim continues into the fur instead of shifting outward.
    ctx.save();ctx.translate(x,y);ctx.clip(path);
    ctx.drawImage(lighting,f[0],f[1],f[15],1,f[4],f[5]-tallest-2,f[2],tallest+3);
    ctx.drawImage(lighting,f[0],f[1],f[15],f[16],f[4],f[5],f[2],f[3]);ctx.restore();
  }


  function drawHead(ctx,h,f,x,y) {
    const view=views.reduce((a,b)=>Math.abs(b[0]-h.yaw)<Math.abs(a[0]-h.yaw)?b:a);
    const [,sx,sy,w,height]=view,rx=w/420,ry=height/367,s=h.width/400;
    if(!plate)plate=smallSurface(w,height);
    if(!overlap)overlap=smallSurface(w,height);
    plate.clearRect(0,0,w,height);plate.drawImage(face,sx,sy,w,height,0,0,w,height);
    if(view[0]===0){
      // A frontal guest already uses the seated pet's eyes and whiskers.
      // Sample that face at its registered location even during the last
      // few moving cels, so the desktop handoff has just one set of pupils.
      const h0=motion.seat.frames[motion.seat.frames.length-1][11],scale=h0[2]/400;
      plate.save();plate.globalCompositeOperation='source-in';
      plate.drawImage(native,seat+h0[0]-210*scale,floor+h0[1]-165*scale,420*scale,367*scale,0,0,w,height);
      plate.restore();
    }
    if(eyeStates && h.tension>=eyeStates[0][0]/2 && view[0]===45){
      const part=eyeStates.reduce((a,b)=>Math.abs(b[0]-h.tension)<Math.abs(a[0]-h.tension)?b:a);
      const [,ux,uy,ew,eh,dx,dy]=part;
      plate.drawImage(lids,ux,uy,ew,eh,dx,dy,ew,eh);
    }else if(!eyeStates && h.tension>0 && view[0]===45){
      plate.save();plate.scale(rx,ry);plate.globalCompositeOperation='source-atop';
      for(const [sx,sy,pw,ph,u,v,cx,cy,ew,eh,side] of lidParts){
        const slope=side*.57*eh/ew*Math.min(1,.58+.42*ew/eh)*h.tension;
        const mid=cy+eh*(-.76+.75*h.tension);
        const a=mid+(u-cx)*slope,b=mid+(u+pw-cx)*slope;
        plate.save();plate.beginPath();plate.moveTo(u,v-2);plate.lineTo(u+pw,v-2);
        plate.lineTo(u+pw,b);plate.quadraticCurveTo(u+pw*.5,(a+b)*.5+2*h.tension,u,a);
        plate.closePath();plate.clip();plate.drawImage(lids,sx,sy,pw,ph,u,v,pw,ph);plate.restore();
      }
      plate.restore();
    }
    overlap.clearRect(0,0,w,height);overlap.save();
    overlap.scale(rx,ry);overlap.translate(210,165);overlap.scale(1/s,1/s);
    overlap.translate(x-h.x,y-h.y);overlap.fill(f[12],'evenodd');overlap.restore();
    overlap.globalCompositeOperation='source-in';overlap.drawImage(neck,sx*neck.width/face.width,sy*neck.height/face.height,
      w*neck.width/face.width,height*neck.height/face.height,0,0,w,height);
    overlap.globalCompositeOperation='source-over';plate.globalCompositeOperation='destination-out';
    plate.drawImage(overlap.canvas,0,0);plate.globalCompositeOperation='source-over';
    ctx.drawImage(plate.canvas,h.x-210*s,h.y-165*s,420*s,367*s);
  }

  // Reconstruct the small throat sector from this pose's cheek and chest.
  // Physical coordinates here are normalized to a 277 px frontal head width.
  const neckCache=new WeakMap();
  let neckSample;
  const neckBox={x:32,y:205,w:296,h:225,scale:.58};
  function neckTransition(ctx,h,f,x,y) {
    const armDown=smooth(between(.65,.87,(f[7]-f[11][1])/f[11][2]));
    if(h.yaw<30||!armDown)return;
    let patch=neckCache.get(f);
    if(!patch){patch=makeThroat({...h,yaw:45,tension:0},f,x,y);neckCache.set(f,patch);}
    const k=h.width/277;
    ctx.save();
    if(armDown<.999 || h.yaw<44.9){
      // While the paw rises, keep any partial-tone patch inside the current
      // shoulder. Fading the filled external contour leaves a second grey arm.
      ctx.translate(x,y);ctx.clip(f[12],'evenodd');ctx.translate(-x,-y);
    }
    ctx.globalAlpha*=armDown*smooth(between(30,42,h.yaw));
    ctx.drawImage(patch,h.x+(neckBox.x-180)*k,h.y+(neckBox.y-155)*k,neckBox.w*k,neckBox.h*k);
    ctx.restore();
  }
  function makeThroat(h,f,x,y) {
    const box=neckBox,w=Math.round(box.w*box.scale),rows=Math.round(box.h*box.scale);
    const sample=neckSample||(neckSample=smallSurface(w,rows));
    const px=w/box.w,py=rows/box.h,world=277/h.width;
    sample.clearRect(0,0,w,rows);sample.save();sample.scale(px,py);
    sample.translate(180-box.x,155-box.y);sample.scale(world,world);sample.translate(-h.x,-h.y);
    drawCoat(sample,f,x,y,f[12]);drawHead(sample,h,f,x,y);sample.restore();
    const raw=sample.getImageData(0,0,w,rows).data;
    const edge=new Float32Array(rows);
    for(let r=0;r<rows;r++){
      let c=0;
      for(;c<w-6;c++)if(raw[(r*w+c)*4+3]>130&&raw[(r*w+c+2)*4+3]>220&&raw[(r*w+c+4)*4+3]>220)break;
      const now=raw[(r*w+c)*4+3],prior=c?raw[(r*w+c-1)*4+3]:0;
      edge[r]=c>0&&now>prior?c-.5+Math.max(0,Math.min(1,(128-prior)/(now-prior))):c;
    }
    // Close the two inward corners (under the jaw and at the elbow) with
    // the envelope of a rolling circle. Preserve the swatting forepaw.
    const radius=Math.round(120*py),arc=new Float32Array(radius*2+1),left=new Float32Array(rows),closed=new Float32Array(rows);
    for(let d=-radius;d<=radius;d++)arc[radius+d]=Math.sqrt(radius*radius-d*d);
    for(let r=0;r<rows;r++){
      let a=1e5;for(let j=Math.max(0,r-radius);j<=Math.min(rows-1,r+radius);j++)a=Math.min(a,edge[j]-arc[radius+j-r]);
      left[r]=a;
    }
    for(let r=0;r<rows;r++){
      let b=-1e5;for(let j=Math.max(0,r-radius);j<=Math.min(rows-1,r+radius);j++)b=Math.max(b,left[j]+arc[radius+j-r]);
      closed[r]=b;
    }
    const canvas=smallSurface(w,rows),image=canvas.createImageData(w,rows),dst=image.data;
    const ypx=y=>Math.max(0,Math.min(rows-1,Math.round((y-box.y)*py)));
    const xpx=x=>Math.max(0,Math.min(w-1,Math.round((x-box.x)*px)));
    const sampleAt=(r,c)=>4*(r*w+Math.max(0,Math.min(w-1,Math.max(c,Math.ceil(edge[r])+4))));
    // Fit a broad tonal field across the coat. The narrow whiskers are
    // brighter than cheek fur, so sample a lower median across a small area.
    // Interpolate across sparse columns instead of propagating individual hairs.
    const jawAt=u=>236+25*Math.exp(-(((u-170)/85)**2));
    const topColors=[];
    for(let u=box.x;u<=box.x+box.w+10;u+=9){
      const center=ypx(jawAt(u)-19),column=xpx(u),colors=[];
      for(let dr=-3;dr<=3;dr++)for(let dc=-4;dc<=4;dc+=2){
        const k=sampleAt(center+dr,column+dc);
        colors.push([raw[k],raw[k+1],raw[k+2]]);
      }
      colors.sort((a,b)=>(a[0]+a[1]+a[2])-(b[0]+b[1]+b[2]));
      const lo=colors.slice(6,17);topColors.push([0,1,2].map(k=>lo.reduce((sum,col)=>sum+col[k],0)/lo.length));
    }
    const contour=new Float32Array(rows);
    for(let r=0;r<rows;r++){
      const v=box.y+(r+.5)/py,orig=box.x+edge[r]/px;
      const room=24*smooth(between(237,257,v))*(1-smooth(between(390,419,v)))*smooth(between(56,96,orig));
      contour[r]=orig-Math.min(room,Math.max(0,(edge[r]-closed[r])/px));
    }
    for(let r=0;r<rows;r++){
      const v=box.y+(r+.5)/py,orig=box.x+edge[r]/px;
      const clipY=smooth(between(236,249,v))*(1-smooth(between(390,419,v)));
      if(!clipY)continue;
      let filtered=0,weights=0;
      for(let j=Math.max(0,r-5);j<=Math.min(rows-1,r+5);j++){
        const weight=6-Math.abs(r-j);filtered+=weight*contour[j];weights+=weight;
      }
      const front=Math.min(orig,filtered/weights),move=orig-front;
      for(let c=Math.max(0,xpx(Math.max(57,front-3)));c<w;c++){
        const u=box.x+(c+.5)/px;
        if(u>=292)break;
        const jaw=jawAt(u);
        const feather=smooth(between(jaw-20,jaw-6,v))*(1-smooth(between(jaw+25,jaw+62,v)));
        const i=4*(r*w+c),originalA=raw[i+3]/255;
        // Only fill the outside of the left silhouette. Interior voids between
        // the raised wrist and the breast are retained.
        const outside=smooth(between(.3,2,move))*(1-smooth(between(orig+1,orig+5,u)))*smooth(between(front-1,front+1,u));
        const band=(1-smooth(between(orig+2,orig+31,u)))*clipY;
        const opacity=Math.max(outside,Math.max(band,feather)*originalA*clipY)*(1-smooth(between(238,292,u)));
        if(opacity<.003)continue;
        if(eyeStates){
          // Colored cheeks can carry white whiskers, a black mask or a calico patch.
          // Extend the local coat into the added silhouette without dragging
          // those high-contrast markings from the face down into the chest.
          const neighbor=sampleAt(r,c),up=sampleAt(Math.max(0,r-2),c),down=sampleAt(Math.min(rows-1,r+2),c);
          const interior=1-smooth(between(orig+1,orig+13,u));
          const a=Math.max(outside,interior*band*originalA)*clipY;
          if(a>.003){
            for(let ch=0;ch<3;ch++)dst[i+ch]=.5*raw[neighbor+ch]+.25*(raw[up+ch]+raw[down+ch]);
            dst[i+3]=Math.round(255*a);
          }
          continue;
        }
        const below=ypx(Math.max(v,jaw+53));
        const pos=(u-box.x)/9,idx=Math.floor(pos),weight=pos-idx;
        const bottom=sampleAt(below,c);
        // Carry charcoal cheek color down into the existing warm-black coat.
        const blend=smooth(between(jaw-18,jaw+58,v));
        for(let ch=0;ch<3;ch++){
          const top=mix(topColors[idx][ch],topColors[idx+1][ch],weight);
          dst[i+ch]=mix(top,raw[bottom+ch],blend);
        }
        dst[i+3]=Math.round(255*opacity);
      }
    }
    canvas.putImageData(image,0,0);return canvas.canvas;
  }


  // Stage time in seconds paired with time on the original drawn performance.
  // Keep the swat, recoil and final sit at their original speeds.
  const beats = [
    [0,0], [.32,.46], [contactTime,.86], [.98,1.12], [2,2.60],
    [2.45,3.05], [3.61,4.61], [5,6]
  ];
  function celTime(seconds) {
    for (let i=1; i<beats.length; i++) {
      const [end, last]=beats[i];
      if (seconds<=end) {
        const [start, first]=beats[i-1];
        const fraction=(Math.max(0,seconds)-start)/(end-start);
        return first+(last-first)*fraction;
      }
    }
    return beats[beats.length-1][1];
  }

  const limit = x => Math.min(1, Math.max(0, x));
  const between = (a, b, t) => limit((t - a) / (b - a));
  const smooth = x => { x = limit(x); return x * x * (3 - 2 * x); };
  const mix = (a, b, t) => a + (b - a) * t;
  function read(name, value) {
    const clip = motion[name];
    const frame = clip.frames[Math.round(limit(value) * (clip.frames.length - 1))];
    return {clip, frame};
  }
  function cycle(cycles,name='walk') {
    const clip = motion[name];
    const i = Math.round(cycles * clip.frames.length);
    return {clip, frame:clip.frames[(i % clip.frames.length + clip.frames.length) % clip.frames.length]};
  }
  function walkExposure(u,laps,from,to) {
    const f=motion.walk.frames, stride=tread[f.length];
    const cycle=u*laps, whole=Math.floor(cycle), where=(cycle-whole)*stride;
    let i=0;
    while(i<f.length && where>(tread[i]+tread[i+1])*.5)i++;
    const x=mix(from,to,u);
    const registeredX=mix(from,to,(whole+tread[i]/stride)/laps);
    return {x,frame:f[i%f.length],soleOffset:registeredX-x};
  }

  function contactShadow(ctx, frame, x, y, opacity) {
    const feet = frame[10];
    if (!feet || !opacity) return;
    for (const [center, width, weight] of feet) {
      ctx.save();
      ctx.translate(x + center, y - 2);
      ctx.scale(width, 6);
      const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      shade.addColorStop(0, 'rgba(40,43,53,' + (.14 * opacity * weight).toFixed(3) + ')');
      shade.addColorStop(1, 'rgba(40,43,53,0)');
      ctx.fillStyle = shade;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }

  actors.drawGuest = function (ctx, seconds, behind) {
    if (!native || !motion.seat) return;
    const t = celTime(seconds);
    if (t >= 5.55) {
      const head={x:504.54,y:190.37,width:281.47,yaw:0,pitch:0,native:true};
      behind?.(head);
      ctx.drawImage(native, 0, 0);
      return {pose:'native', paw:[346,538], nose:[501.81,265.71], mouthOpen:0, mouthAnchor:null,
        head};
    }
    const last = motion.extend.frames[motion.extend.frames.length-1];
    const stand = touch[0] - last[6];
    const begin = 1080 - motion.walk.frames[0][8];
    const faceOff = stand;
    let x, y = floor, photo, pose, soleOffset=0;
    if (t < .46) {
      const u = between(0,.46,t);
      photo=walkExposure(smooth(u),1,begin,stand+52);
      x=photo.x;soleOffset=photo.soleOffset;pose='walk';
    } else if (t < .86) {
      const u = between(.46,.86,t);
      // The rounded tip extends past its anatomical endpoint. Leave the
      // silhouettes apart until the final 20 ms of the actual swat.
      const swat = 15 * smooth(between(.69,.80,t)) * (1-smooth(between(.84,.86,t)));
      x = stand + 52 * (1 - u ** 1.25) + swat;
      photo = read('extend',smooth(u)); pose = 'reach';
    } else if (t < .90) {
      x = stand; photo = read('extend',1); pose = 'touch';
    } else if (t < 1.12) {
      const u = smooth(between(.90,1.12,t));
      x = stand;
      photo = read('flinch',u); pose = 'recoil';
    } else if (t < 2.60) {
      x = faceOff;
      photo = cycle(between(1.12,2.60,t),'watch'); pose = 'arch';
    } else if (t < 3.05) {
      x = faceOff - 14 * smooth(between(2.77,3.05,t));
      photo = read('recover',smooth(between(2.60,3.05,t))); pose = 'lower-back';
    } else if (t < 4.61) {
      const u = between(3.05,4.61,t);
      const distance = u - Math.sin(2*Math.PI*u) / (2*Math.PI) * .61;
      photo=walkExposure(distance,4,faceOff-14,seat+34);
      x=photo.x;soleOffset=photo.soleOffset;pose='walk-to-seat';
    } else if (t < 5.12) {
      const u = smooth(between(4.61,5.12,t));
      x = mix(seat+34,seat,u);
      photo = read('lower',u); pose = 'sit';
    } else {
      x = seat;
      photo = read('seat',smooth(between(5.12,5.41,t))); pose = 'settle';
    }
    const f = photo.frame;
    // Keep both eyes visible through the swat and the walk to the keyboard.
    const turnFront = smooth(between(4.61,5.15,t));
    const faceReaction = smooth(between(.98,1.18,t));
    const h = f[11];
    const head = {x:x+h[0],y:y+h[1],width:h[2],
      yaw:45*(1-turnFront), pitch:0,
      tension:faceReaction*(1-smooth(between(2.60,3.05,t)))};
    const revealNative = smooth(between(5.41,5.55,t));
    behind?.(head);
    contactShadow(ctx,f,x+soleOffset,y,(1-smooth(between(4.85,5.41,t)))*Math.min(1,(y-floor+14)/14));
    if(revealNative>0){
      // The final photographed cel and the desktop seat have the same eye
      // registration. Dissolve their surface detail within one native outline.
      if(!seatPhoto){
        seatPhoto=smallSurface(native.width,native.height);
        drawCoat(seatPhoto,f,x,y,f[12]);drawHead(seatPhoto,head,f,x,y);
        seatMix=smallSurface(native.width,native.height);
      }
      seatMix.clearRect(0,0,native.width,native.height);
      seatMix.drawImage(native,0,0);seatMix.save();
      seatMix.globalCompositeOperation='source-atop';seatMix.globalAlpha=1-revealNative;
      seatMix.drawImage(seatPhoto.canvas,0,0);seatMix.restore();
      ctx.drawImage(seatMix.canvas,0,0);
    }else{
      if(f[14])drawHackles(ctx,f,x,y,smooth(between(.90,1.08,t))*(1-smooth(between(2.60,3.00,t))));
      movingCoat(ctx,f,x,y,f[12],soleOffset);
      drawHead(ctx,head,f,x,y);
      neckTransition(ctx,head,f,x,y);
      movingCoat(ctx,f,x,y,f[13],soleOffset);
    }
    return {pose,head,mouthOpen:0,mouthAnchor:null,paw:[x+f[6],y+f[7]],nose:[x+f[8],y+f[9]]};
  };
})();
(() => {
  'use strict';
  let seat, sheet, data, ready;
  actors.prepareResident = () => ready ??= Promise.all([
    actors.loadArt('base/siamese.webp'),
    actors.loadArt('resident-part/motion.webp'),
    actors.loadData('resident-part/motion.json')
  ]).then(([s, a, d]) => { seat=s; sheet=a; data=d; })
    .catch(error => { ready=undefined; throw error; });

  const clamp = n => Math.max(0,Math.min(n,1));
  const smooth = n => { n=clamp(n); return n*n*(3-2*n); };
  const span = (n, a, b) => clamp((n-a)/(b-a));
  const exit = 4.56;

  function travel(t, a, b, from, to, inSpeed, outSpeed) {
    const u=span(t,a,b);
    return from+(to-from)*smooth(u)+(b-a)*u*(1-u)*((1-u)*inSpeed-u*outSpeed);
  }
  function distance(t) {
    if(t<2.9)return travel(t,1.60,2.90,0,365,0,195);
    if(t<4.1)return travel(t,2.90,4.10,365,535,195,135);
    return travel(t,4.10,exit,535,814,135,80);
  }
  function closest(list,value,key) {
    let i=0;
    while(i+1<list.length && value>=(key(list[i])+key(list[i+1]))/2)i++;
    return i;
  }
  const legEdges=[0,248,390,549,860];
  const rearJoints=[[490,0],[501,.12],[515,.50],[530,.90],[536,1],[572,1]];
  // The Siamese has a short visible shin and large seal-point mitts. Carry the
  // step through its shoulder and white foreleg, keeping the colored pad rigid.
  const foreRows=[[444,0],[458,.11],[477,.36],[498,.68],[518,1],[525,1]];
  const foreCols=[390,438,514,568,758];
  function drawForelegs(ctx,body,distance) {
    const near=residentFootstep(distance,2), far=residentFootstep(distance,3);
    const offsets=[{x:0,y:0},near,near,far,far];
    for(let j=1;j<foreRows.length;j++){
      const [top,from]=foreRows[j-1], [bottom,to]=foreRows[j];
      const dh=bottom-top;
      for(let i=1;i<foreCols.length;i++){
        const l=foreCols[i-1], r=foreCols[i], dw=r-l;
        const a=offsets[i-1], b=offsets[i];
        // Across the shared chest the near foot can plant while the far one
        // lifts. Narrow overlapping strips interpolate both influences. A whole
        // shin needs just one strip where both sides follow the same foot.
        const count=a===b?1:Math.ceil(dh/2), strip=dh/count;
        const x=(l+r)/2, dx=(a.x+b.x)/2, dy=(a.y+b.y)/2, slope=(to-from)/dh;
        for(let k=0;k<count;k++){
          const y=top+(k+.5)*strip, weight=from+(y-top)*slope;
          ctx.save();ctx.translate(x+dx*weight,y+dy*weight);
          ctx.transform(1+(b.x-a.x)*weight/dw,(b.y-a.y)*weight/dw,dx*slope,1+dy*slope,0,0);
          ctx.translate(-x,-y);
          section(ctx,sheet,body,l-1,y-strip/2-.8,r+1,y+strip/2+.8);
          ctx.restore();
        }
      }
    }
    // Draw the rear-facing mitt behind the nearer one if the toes cross.
    for(const i of [3,2]) {
      const paw=i===2?near:far;
      ctx.save();ctx.translate(paw.x,paw.y);
      section(ctx,sheet,body,legEdges[i],524,legEdges[i+1],572);
      ctx.restore();
    }
  }
  function backstep(ctx,body,distance) {
    for(let i=0;i<2;i++){
      drawResidentLeg(ctx,sheet,body,legEdges[i],legEdges[i+1],rearJoints,residentFootstep(distance,i));
    }
    // The two pairs part at different heights. Keep the unbroken chest down
    // to the first clear space between each pair of paws.
    drawForelegs(ctx,body,distance);
    ctx.save();ctx.beginPath();
    ctx.rect(0,0,860,445);ctx.rect(0,444,390,48);ctx.clip();
    section(ctx,sheet,body,0,0,860,492);
    ctx.restore();
  }
  const shift = (p,dx) => [p[0]+dx,p[1]];
  function shadow(ctx, dx, t) {
    ctx.save();ctx.translate(475+dx,559);ctx.scale(176,10);
    const g=ctx.createRadialGradient(0,0,0,0,0,1);
    const a=.12*smooth(span(t,.86,1.05));
    g.addColorStop(0,'rgba(78,57,40,'+a+')');g.addColorStop(1,'rgba(78,57,40,0)');
    ctx.fillStyle=g;ctx.fillRect(-1,-1,2,2);ctx.restore();
  }

  actors.drawResident = (ctx, seconds, behind) => {
    // Use the original cadence relative to the first touch, including the
    // unsped retreat that follows the recorded call.
    const elapsed=seconds-(actors.cueTime??.72), t=.86+elapsed;
    if(elapsed<=0){
      const head={x:504.54,y:190.37,width:281.47,yaw:0};
      behind?.(head);
      if(seat)ctx.drawImage(seat,0,0);
      return {tail:[806.42,390.51],arch:0,root:[502.57,560],pose:'seated',
        mouthOpen:0,mouthAnchor:[501.81,273],eyeAnger:0,head};
    }
    if(t>=exit||!data)return {tail:null,arch:0,pose:'offstage',mouthOpen:0,mouthAnchor:null,eyeAnger:0};

    const dx=-distance(t);
    let i=0;
    while(i+1<data.start.length && t-.86>=data.start[i+1])i++;
    const [body,eyes,mouth,anger]=data.poses[i];
    const tail=data.tails[closest(data.tails,elapsed*50,k=>k[0])];
    // Register the cap to the eye midpoint of each photographed exposure.
    const turn=Math.min(i/(data.start.length-1),1);
    const head={x:dx+(eyes[0][0]+eyes[1][0])/2+3.2-53*turn,
      y:(eyes[0][1]+eyes[1][1])/2-37, width:281.47-24*turn, yaw:-45*turn};
    behind?.(head);
    shadow(ctx,dx,t);
    ctx.save();ctx.translate(dx,0);
    ctx.drawImage(sheet,...tail[1]);
    if(dx<-.01) backstep(ctx,body,-dx);
    else ctx.drawImage(sheet,...body);
    ctx.restore();
    return {tail:t<1.04?shift(tail[2],dx):null,arch:smooth(span(t,.86,1.02)),root:[502.57+dx,560],
      pose:t<1.02?'startle':t<=1.60?'arch':'retreat',mouthOpen:0,mouthAnchor:shift(mouth,dx),
      head,eyeAnger:anger,eyeAnchors:eyes.map(p=>shift(p,dx))};
  };
})();
  return actors;
}
