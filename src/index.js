/**
 * @todo Use collision detection and spatial partition to constrain forms from
 *   interpenetration while altering radius... but it's tricky, for now just
 *   allow interpenetration and try balance things with the growth/shrink rates.
 */

import { Olta } from '@olta/js-sdk';

import {
    WebGLRenderer, Scene, Raycaster, PerspectiveCamera, Clock,
    Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere,
    InstancedMesh, SphereGeometry, CylinderGeometry, MeshToonMaterial,
    HemisphereLight, PointLight, Color, MathUtils, Fog, DoubleSide,
    BufferGeometry, Mesh, SubtractiveBlending
  } from 'three';

import Stats from 'three/examples/jsm/libs/stats.module.js';
import CameraOrbitControls from 'camera-controls';

import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast }
  from 'three-mesh-bvh';

import { each } from '@epok.tech/fn-lists/each';
import { map } from '@epok.tech/fn-lists/map';
import { range } from '@epok.tech/fn-lists/range';

const { random, round, floor, max, abs, acos, PI: pi } = Math;
const { MAX_SAFE_INTEGER: intMax, EPSILON: eps } = Number;
const { lerp, clamp } = MathUtils;

const api = self.echoes = {};

const query = api.query = new URLSearchParams(location.search);

let wallet;

const depths = api.depths = [1, 1e4];
const [near, far] = depths;

// Bounds are for maximum range and accuracy as `olta` only accepts integers.
const bounds = api.bounds = [-intMax, intMax];
// Bounds rescaled by this for front-end convenience with `three`.
const positionScale = api.positionScale = 2e-7;

const radii = api.radii = [1, 1e2];
const [r0, r1] = radii;
const growth = 1.5;

const teams = api.teams = 3;
const team = api.team = floor(random()*teams);
const hunt = (t) => (t+1)%teams;
const flee = (t) => (t+2)%teams;

const colors = api.colors = {
  any: [0x00bbbb, 0xbb00bb, 0xbbbb00],
  own: [0x44ffff, 0xff44ff, 0xffff44]
};

const $body = api.$body = document.body;
const $canvas = api.$canvas = document.querySelector('canvas');

const size = new Vector2();

// @todo Use a simpler sphere intersection test instead.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

CameraOrbitControls.install({
  THREE: {
    WebGLRenderer, Raycaster,
    Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere
  }
});

const renderer = api.renderer =
  new WebGLRenderer({ canvas: $canvas, antialias: true });

renderer.setPixelRatio(devicePixelRatio);
renderer.setClearColor(0xffffff);

const scene = api.scene = new Scene();
const clock = api.clock = new Clock();

const camera = api.camera = new PerspectiveCamera(60, 1, ...depths);

// camera.position.set(0, 0, eps);
camera.position.set(0, 0, 1e-5);

const orbit = api.orbit = new CameraOrbitControls(camera, $canvas);

orbit.infinityDolly = orbit.dollyToCursor = true;
// orbit.infinityDolly = true;
orbit.minDistance = orbit.maxDistance = r1;
orbit.setPosition(0, 0, 1e3, false);
orbit.dollySpeed = 2;
orbit.truckSpeed = 5;
orbit.saveState();

scene.fog = new Fog(0xffffff, ...depths);

const lightCamera = api.lightCamera = new PointLight(0xffffff, 1e5);

lightCamera.position.set(0, r1, -r1);
scene.add(camera.add(lightCamera));

const lightSky = api.lightSky = new HemisphereLight(0xffffff, 0x000000, 0.5);

scene.add(lightSky);

const forms = api.forms = {
  geometry: new SphereGeometry(1),
  material: new MeshToonMaterial(),
  data: [],
  meshes: [],
  limits: []
};

forms.geometry.computeBoundsTree();

const bvh = forms.geometry.boundsTree;
const spheres = [new Sphere(), new Sphere()];

const hint = api.hint = new Mesh(forms.geometry, new MeshToonMaterial({
  transparent: true, opacity: 0.3, side: DoubleSide, depthWrite: false
}));

hint.visible = false;
hint.material.color.setHex(colors.own[team]);
scene.add(hint);

const hit = api.hit = new Mesh(new CylinderGeometry(0.3, 0.1, 1, 2**5, 1, true),
  new MeshToonMaterial({
    transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false,
    blending: SubtractiveBlending, fog: false
  }));

hit.visible = false;
hit.geometry.translate(0, 0.5, 0);
hit.geometry.rotateX(pi*0.5);
scene.add(hit);

const raycaster = api.raycaster = new Raycaster();

raycaster.firstHitOnly = true;

const transform = new Matrix4();
const color = new Color();
const pointer = api.pointer = new Vector2();
const axes = api.axes = new Vector2(1, -1);

const stats = api.stats = ((query.has('stats'))? new Stats() : null);

stats && $body.appendChild(stats.dom);

let needRender = false;

const render = api.render = () => {
  // console.log('render');
  renderer.render(scene, camera);
  needRender = false;
};

const resize = api.resize = () => {
  const { width: w, height: h } = $canvas.getBoundingClientRect();

  size.set(w, h);
  renderer.setSize(w, h, 0);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  render();
};

const frame = api.frame = () => {
  requestAnimationFrame(frame);

  const dt = clock.getDelta();

  (orbit.update(dt) || needRender) && render();
  stats?.update?.();
}

const held = {};
const hold = 1e3;

const clearHeld = api.clearHeld = (id) => {
  const t = held[id];

  clearTimeout(t);
  delete held[id];

  return t;
};

// @todo Animate hint color over time.
$canvas.addEventListener('pointerdown', ({ pointerId: id }) => {
  clearTimeout(held[id]);

  held[id] = setTimeout(() => {
      if(!clearHeld(id)) { return; }

      const { visible: hv, scale: hs, position: hp } = hint;

      if(!hv) { return; }

      const { x, y, z } = hp;
      const ps = positionScale;

      // @todo Check `state` settings to use dynamically, for limits etc?
      const to = {
        t: team,
        r: round(clamp(hs.x, ...radii)),
        x: round(clamp(x/ps, ...bounds)),
        y: round(clamp(y/ps, ...bounds)),
        z: round(clamp(z/ps, ...bounds))
      };

      console.log('create', to);
      olta.create('forms', to);
      hint.visible = false;
      needRender = true;
    },
    hold);
});

const lift = (e) => clearHeld(e.pointerId);

$canvas.addEventListener('pointermove', lift);
$canvas.addEventListener('pointerup', lift);
$canvas.addEventListener('pointercancel', lift);
$canvas.addEventListener('pointerout', lift);
$canvas.addEventListener('pointerleave', lift);

$canvas.addEventListener('pointermove', ({ clientX: x, clientY: y }) => {
  const { meshes, data } = forms;
  const to = meshes[team];

  needRender = true;

  if(!to) { return hit.visible = hint.visible = false; }

  pointer.set(x, y).divide(size).multiplyScalar(2).subScalar(1).multiply(axes);
  raycaster.setFromCamera(pointer, camera);

  // @todo BVH is unnecessary, just use `ray.intersectsSphere` instead.
  const [at] = raycaster.intersectObjects(meshes);

  if(!at) { return hit.visible = hint.visible = false; }

  const { object: mesh, instanceId: i, point: p, normal: n } = at;
  const t = meshes.indexOf(mesh);
  const form = data[t][i];
  const { r } = form;

  // console.log('hit', at, p, mesh, form);
  hit.visible = true;
  hit.position.copy(p);
  hit.scale.setScalar(r*0.2);
  hit.material.color.setHex(colors.any[t]);
  hit.lookAt(p.add(n));

  if(t !== team) { return hint.visible = false; }

  // console.log('hint');
  hint.visible = true;
  hint.position.copy(p);
  // Starting radius.
  hint.scale.setScalar(r);

  // Check the other team forms with `intersectSphere`:
  // - Decrease radius if touching a team to flee.
  // - Increase radius if touching a team to hunt.
  const tf = flee(team);
  const th = hunt(team);
  const { [tf]: mf, [th]: mh } = meshes;
  const { [tf]: df, [th]: dh } = data;
  const [s0, s1] = spheres;
  const ps = positionScale;

  s0.center.copy(p);
  s0.radius = r;

  const intersect = (d) => d.some(({ x, y, z, r }, i) => {
    s1.center.set(x*ps, y*ps, z*ps);
    s1.radius = r;

    return s0.intersectsSphere(s1);
  });

  // @todo Check hunt first, increase radius if touched, then check flee and
  //   decrease radius to nearest touch.
  let dr = ((intersect(df))? 1/growth : intersect(dh) && growth);

  // @todo Animate hint radius over time.
  dr && ((dr = clamp(r*dr, ...radii)) !== r) && hint.scale.setScalar(dr);
});

// @todo Find a way to sensibly set the camera to orbit around the intersection.
// orbit.addEventListener('controlstart', () => {
//   const { visible: v, position: p } = hit;

//   if(!v) { return; }

//   const { x: px, y: py, z: pz } = p;

//   orbit.setOrbitPoint(px, py, pz);
//   needRender = true;
// });

addEventListener('resize', resize);
resize();
frame();

const olta = api.olta = Olta();

const dataToScene = api.dataToScene = (to) => {
  // @todo Construct a KD-Tree, and only create enough meshes for nearby range.
  const tl = to.length;
  const { geometry, material, data, meshes, limits } = forms;

  if(!tl) {
    each((m) => m.removeFromParent().dispose(), meshes);

    return data.length = limits.length = meshes.length = 0;
  }

  // Group data by team.
  each((v) => (data[v.t] ??= []).push(v), to);

  each((d, t) => {
      const dl = d.length;
      let m = meshes[t];

      // Set up a larger instanced mesh if needed.
      if(!m || ((limits[t] ?? 0) < dl)) {
        m?.removeFromParent?.().dispose?.();

        scene.add(m = meshes[t] =
          new InstancedMesh(geometry, material, limits[t] = dl));
      }
      // Just reduce the instance draw count if the limit is high enough.
      else { m.count = dl; }

      // Set up the mesh instances.
      const ps = positionScale;

      each(({ r, x, y, z, _creator }, i) => {
          m.setMatrixAt(i,
            transform.makeScale(r, r, r).setPosition(x*ps, y*ps, z*ps));

          // @todo Alternate color for forms added by the same creator.
          m.setColorAt(i,
            color.setHex(colors[(_creator === wallet)? 'own' : 'any'][t]));
        },
        d);

      m.instanceMatrix.needsUpdate = m.instanceColor.needsUpdate = true;
    },
    data);

  needRender = true;
  // console.log('forms', forms);
};

const update = api.update = (state) => {
  const to = olta.getAll('forms');

  console.log('data', to, state);

  if(!to) { return; }

  dataToScene(to);
  wallet = state.activeWalletAddress;
};

olta.onUpdate(update);

each(($b) => $b.addEventListener('click', () => orbit.reset(true)),
  document.querySelectorAll('.recenter'));
