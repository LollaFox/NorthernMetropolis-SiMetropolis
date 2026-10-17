import * as THREE from './vendor/three.module.js';
export class PortFlows {
  constructor(scene) {
    this.group=new THREE.Group();this.group.userData.policyOverlay=true;this.group.visible=false;scene.add(this.group);
    this.elapsed=0;this.animated=true;this.paths=[];
    this.markerGeometry=new THREE.ConeGeometry(1.0,3.2,6);
    this.dummy=new THREE.Object3D();this.up=new THREE.Vector3(0,1,0);
  }
  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if(child.geometry!==this.markerGeometry) child.geometry?.dispose();
      child.material?.map?.dispose();child.material?.dispose();
    }
    this.paths=[];
  }
  update(snapshot,mode='policy',groupId='all') {
    this.clear();if(!snapshot)return;
    const cohort=groupId==='all'?null:snapshot.groups.find(g=>g.id===groupId);
    const port=new THREE.Vector3(-14,4,-87);
    const dot=new THREE.Mesh(new THREE.CylinderGeometry(3,3,1,24),new THREE.MeshBasicMaterial({color:0xffdf91}));dot.position.copy(port);this.group.add(dot);
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=90;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#163139';ctx.fillRect(0,0,512,90);ctx.fillStyle='#ffdf91';ctx.font='600 26px sans-serif';ctx.textAlign='center';ctx.fillText('HUANGGANG PORT',256,36);ctx.font='18px sans-serif';ctx.fillStyle='#e2ede4';ctx.fillText('Schematic location · passenger flows',256,67);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));label.scale.set(72,12.7,1);label.position.set(-14,24,-94);label.renderOrder=12;this.group.add(label);
    for(const route of snapshot.routes) {
      for(const direction of ['inbound','outbound']) {
        const fraction=cohort?(direction==='inbound'?cohort.inbound:1-cohort.inbound):null;
        // Additional demand has a different cohort mix from the baseline.
        // Preserve the model's separate directional counts instead of reusing
        // the baseline inbound share for the additional-trip overlay.
        const baseline=cohort?cohort.baseline*route.share*fraction:route[`${direction}Baseline`];
        const extra=cohort?cohort.extra*route.share*fraction:route[`${direction}Extra`];
        const offset=direction==='inbound'?-2:2;
        const start=port.clone().add(new THREE.Vector3(offset,0,0));
        const end=new THREE.Vector3(route.x+offset,3.5,route.z);
        const curve=new THREE.QuadraticBezierCurve3(start,new THREE.Vector3((start.x+end.x)/2+offset*2,40,(start.z+end.z)/2),end);
        // Grey context is always baseline. Gold is only the additional scenario demand.
        this.addPath(curve,baseline,0x28c3d7,direction,mode==='delta'?.16:.8,mode!=='delta');
        if(mode!=='baseline')this.addPath(curve,extra,0xffbd4c,direction,.95,true,1.4);
      }
    }
    this.group.userData.month=snapshot.index;this.group.userData.mode=mode;
  }
  addPath(curve,volume,color,direction,opacity,moving,lift=0) {
    if(volume<=0)return;
    const radius=Math.min(1.4,.2+Math.sqrt(volume/1000)*.28);
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,toneMapped:false});
    const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,36,radius,5,false),material);tube.position.y=lift;this.group.add(tube);
    if(!moving)return;
    // Fixed volume scale across months and modes; arrows are samples, not individuals.
    const count=Math.min(36,Math.max(1,Math.ceil(volume/500)));
    const mesh=new THREE.InstancedMesh(this.markerGeometry,new THREE.MeshBasicMaterial({color,toneMapped:false}),count);mesh.frustumCulled=false;this.group.add(mesh);
    this.paths.push({curve,mesh,count,direction,lift});
  }
  animate(dt) {
    if(!this.group.visible)return;
    if(this.animated)this.elapsed+=dt;
    for(const path of this.paths) {
      for(let i=0;i<path.count;i++) {
        let t=(this.elapsed*.12+i/path.count)%1;
        const sign=path.direction==='inbound'?1:-1;
        if(sign<0)t=1-t;
        this.dummy.position.copy(path.curve.getPoint(t));this.dummy.position.y+=path.lift;
        this.dummy.quaternion.setFromUnitVectors(this.up,path.curve.getTangent(t).normalize().multiplyScalar(sign));
        this.dummy.updateMatrix();path.mesh.setMatrixAt(i,this.dummy.matrix);
      }
      path.mesh.instanceMatrix.needsUpdate=true;
    }
  }
  dispose(){this.clear();this.markerGeometry.dispose();this.group.removeFromParent();}
}
