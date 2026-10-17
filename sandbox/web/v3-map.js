import * as THREE from './vendor/three.module.js';
export const LAND_COLORS=[0xb9cbd1,0xbdc7bb,0xd4d8cc,0xaebeb1,0xe0d9c8,0xefefeb];
// Rendering samples every tenth cell; retained analytical data remains 1000×1000.
export function terrainGeometry(frame) {
  const vertices=[],colors=[],indices=[],xs=Array.from({length:101},(_,i)=>Math.min(999,i*10));
  for(const y of xs) for(const x of xs) {
    const p=y*1000+x,c=new THREE.Color(LAND_COLORS[Math.max(0,frame.landType[p])]);
    vertices.push((x/999-.5)*280,frame.height[p]*280/(1000*frame.grid.cellSizeM),(y/999-.5)*280);
    colors.push(c.r,c.g,c.b);
  }
  for(let y=0;y<100;y++) for(let x=0;x<100;x++) {
    const ids=[y*101+x,(y+1)*101+x,y*101+x+1,(y+1)*101+x+1];
    // Do not span excluded cells, including gaps between sampled vertices.
    let outside=false;
    for(let yy=xs[y];yy<=xs[y+1]&&!outside;yy++) for(let xx=xs[x];xx<=xs[x+1];xx++) if(frame.landType[yy*1000+xx]===-1){outside=true;break;}
    if(!outside) indices.push(ids[0],ids[1],ids[2],ids[2],ids[1],ids[3]);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
export class V3Map {
  constructor(city) {
    this.city=city; city.playing=false;city.portFlows.group.visible=false;
    // The illustrative H3 city is not used as backend geography.
    this.legacyContext=new THREE.Group();this.legacyContext.visible=false;
    for(const child of [...city.scene.children]) if(!child.isLight) this.legacyContext.add(child);
    city.scene.add(this.legacyContext);
    this.root=new THREE.Group();this.root.userData.policyOverlay=true;city.scene.add(this.root);city.externalMapActive=true;this.layers={};
    city.canvas.setAttribute('aria-label','Simulation terrain and infrastructure. Drag to orbit, scroll to zoom.');
  }
  clear() {
    this.root.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
    this.root.clear();this.layers={};
  }
  show(frame) {
    this.clear();this.frame=frame;
    const group=name=>{const g=new THREE.Group();this.layers[name]=g;this.root.add(g);return g;};
    group('terrain').add(new THREE.Mesh(terrainGeometry(frame),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,side:THREE.DoubleSide})));
    const pos=(p,offset=0)=>new THREE.Vector3((p[0]/999-.5)*280,frame.height[p[1]*1000+p[0]]*280/(1000*frame.grid.cellSizeM)+offset,(p[1]/999-.5)*280);
    const line=(g,points,color,offset=1)=>g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>pos(p,offset+(p[2]||0)*.08))),new THREE.LineBasicMaterial({color,toneMapped:false})));
    const roads=group('roads');frame.roads.forEach(l=>line(roads,l.points,0xddaa44));
    const mtr=group('mtr');frame.mtr.forEach(l=>line(mtr,l.points,0x069db2,2));
    const zones=group('zones');frame.zones.forEach(z=>line(zones,z.boundary,0x605897,1.5));
    const power=group('power');frame.powerLines.forEach(l=>line(power,l,0xb86a99,3));
    const pollution=group('pollution');
    for(const p of frame.pollution) {
      const radius=p[2]/999*280;
      if(radius===0) continue;
      const mesh=new THREE.Mesh(new THREE.RingGeometry(Math.max(0,radius-.35),radius,48),new THREE.MeshBasicMaterial({color:p[3]===0?0x007cb0:0xce672b,side:THREE.DoubleSide,transparent:true,opacity:.75,toneMapped:false}));
      mesh.rotation.x=-Math.PI/2;mesh.position.copy(pos(p,2));pollution.add(mesh);
    }
    this.city.canvas.dataset.snapshotDate=frame.date;
    this.city.canvas.dataset.gridCells=String(frame.height.length);
    this.city.renderer.shadowMap.needsUpdate=true;
  }
  restore(){this.clear();for(const child of [...this.legacyContext.children])this.city.scene.add(child);this.legacyContext.removeFromParent();this.root.removeFromParent();this.city.externalMapActive=false;this.city.canvas.removeAttribute?.('data-snapshot-date');this.city.resetCamera?.();}
  toggle(name,visible){if(this.layers[name]) this.layers[name].visible=visible;}
}
