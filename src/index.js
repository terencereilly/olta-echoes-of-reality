/**
 * @todo Address Terrence's Figma notes.
 * @todo Animations: hint radius, hint colour filling, trace colour pulse.
 * @todo Replay time: add shapes in sequence (by `_sortKey` or `_id`?),
 *   on intro or idle.
 * @todo Offset touch target to above fingertip so it's visible.
 * @todo Distinct touch interactions for moving target versus camera.
 * @todo Make camera move more consistently, especially dolly out...
 * @todo Icons to explain `hunt`, `team`, `flee` interaction.
 * @todo Style updates according to Terrence's mood, colour, post references.
 * @todo Maybe add sphere BVH to optimise later.
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
    BufferGeometry, Mesh, Group
  } from 'three';

import Stats from 'three/examples/jsm/libs/stats.module.js';
import CameraOrbitControls from 'camera-controls';

import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast }
  from 'three-mesh-bvh';

import { each } from '@epok.tech/fn-lists/each';
import { map } from '@epok.tech/fn-lists/map';
import { reduce } from '@epok.tech/fn-lists/reduce';
import { range } from '@epok.tech/fn-lists/range';

const { random, round, floor, min, max, abs, acos, PI: pi } = Math;
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
const positionScale = api.positionScale = 3e-13;

const radii = api.radii = [1, 1e2];
const [r0, r1] = radii;

const growth = 1.5;
const shrink = 0.9;
const inner = 0.95;

const boundRadius = (intMax*positionScale)+r1;

const teams = api.teams = 3;
const team = api.team = parseInt(query.get('team') || floor(random()*teams));
const hunt = (t) => (t+1)%teams;
const flee = (t) => (t+2)%teams;

const colors = api.colors = {
  // any: [0x00bbbb, 0xbb00bb, 0xbbbb00],
  // own: [0x44ffff, 0xff44ff, 0xffff44]
  any: [0x3033d4, 0xb02940, 0xefa53b],
  own: [0x44ffff, 0xff44ff, 0xffff44]
};

const $body = api.$body = document.body;
const $canvas = api.$canvas = document.querySelector('canvas');

const size = new Vector2();

// BVH is only maybe used by `orbit`, `forms` use sphere intersection instead.
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
const orbit = api.orbit = new CameraOrbitControls(camera, $canvas);
const orbitStart = boundRadius*2;

orbit.infinityDolly = orbit.dollyToCursor = true;
orbit.minDistance = orbit.maxDistance = r1;
orbit.dollySpeed = 3;
orbit.truckSpeed = 10;
orbit.setLookAt(0, 0, orbitStart+orbit.minDistance, 0, 0, orbitStart, true);
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
  data: [], meshes: [], limits: []
};

forms.geometry.computeBoundsTree();

const spheres = [new Sphere()];
const vector3s = [new Vector3(), new Vector3(), new Vector3()];

function dataToSphere({ x, y, z, r }, s) {
  s.center.set(x, y, z).multiplyScalar(positionScale);
  s.radius = r;

  return s;
}

const hint = api.hint = new Mesh(forms.geometry, new MeshToonMaterial({
  transparent: true, opacity: 0.3, side: DoubleSide, depthWrite: false,
  color: colors.own[team]
}));

hint.visible = false;
scene.add(hint);

const hit = api.hit = new Mesh(new CylinderGeometry(0.1, 0.5, 1, 2**5, 1, true),
  new MeshToonMaterial({
    transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false,
    color: colors.own[team], fog: false
  }));

hit.visible = false;
hit.geometry.translate(0, 0.5, 0);
hit.geometry.rotateX(pi*0.5);
scene.add(hit);

const traces = new Group();

const traceMaterial = new MeshToonMaterial({
  transparent: true, opacity: 0.7, side: DoubleSide, depthWrite: false,
  color: colors.own[team], fog: false
});

function toTrace(x, y, z, r) {
  const t = new Mesh(forms.geometry, traceMaterial);
  const { position: p, scale: s } = t;

  p.set(x, y, z);
  s.multiplyScalar(r*inner);
  traces.add(t);

  return t;
}

scene.add(traces);

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
      const r = hs.x;
      const ps = positionScale;

      // @todo Check `state` settings to use dynamically, for limits etc?
      const to = {
        t: team,
        x: round(clamp(x/ps, ...bounds)),
        y: round(clamp(y/ps, ...bounds)),
        z: round(clamp(z/ps, ...bounds)),
        r: round(clamp(r, ...radii))
      };

      console.log('create', to);
      olta.create('forms', to);
      toTrace(x, y, z, r);
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
  const { data } = forms;

  needRender = true;

  if(!data?.length) { return hit.visible = hint.visible = false; }

  pointer.set(x, y).divide(size).multiplyScalar(2).subScalar(1).multiply(axes);
  raycaster.setFromCamera(pointer, camera);

  const { ray, ray: { origin: ro } } = raycaster;
  const [s] = spheres;
  const [p, v, c] = vector3s;
  let at;

  const l2 = reduce((l2, ds) =>
      reduce((l2, d) => {
        if(!ray.intersectSphere(dataToSphere(d, s), v)) { return l2; }

        const vl2 = v.distanceToSquared(ro);

        if(l2 < vl2) { return l2; }

        at = d;
        p.copy(v);
        c.copy(s.center);

        return vl2;
      },
      ds, l2),
    data, Infinity);

  if(l2 === Infinity) { return hit.visible = hint.visible = false; }

  const { t } = at;
  const ar = at.r;

  hit.lookAt(v.copy(hit.position.copy(p)).add(p).sub(c));
  hit.visible = true;

  if(t === team) { hit.material.color.setHex(0x000000); }
  else {
    hit.material.color.setHex(colors.own[team]);
    hit.scale.setScalar(ar*0.2);

    return hint.visible = false;
  }

  // Check the other team forms intersected:
  // - Increase radius if touching a team to `hunt`.
  // - Decrease radius to avoid touching a team to `flee`.
  const { [hunt(team)]: dh, [flee(team)]: df } = data;
  let r = ar;

  // Check `hunt` first, increase radius if touched, proportional to how much of
  // each form (radius) is crossed.
  // @todo Optimise using squared-distance comparisons.
  r *= lerp(1, growth,
    clamp(reduce((to, d) =>
          to+(clamp((r-dataToSphere(d, s).distanceToPoint(p))/r, 0, 1)),
        dh, 0),
      0, 1));

  // Check `flee` and decrease radius to nearest touch.
  // @todo Optimise using squared-distance comparisons.
  r = reduce((to, d) => min(to, dataToSphere(d, s).distanceToPoint(p)), df, r);

  // @todo Animate hint radius over time.
  if(r < r0) { return hint.visible = false; }

  hint.scale.setScalar(min(r*shrink, r1));
  hint.position.copy(p);
  hint.visible = true;
  hit.scale.setScalar(r*0.2);

  // @todo Interpolate colour to mix towards `hunt` (if `r > ar`) or
  // `flee` (if `r < ar`), then animate back to its normal colour.
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

  map(() => [],
    ((data.length)? data : ((data.length = teams) && range(data))), 0);

  // Group data by team.
  each((v) => data[v.t].push(v), to);

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

      each(({ x, y, z, r, _creator }, i) => {
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
  console.log('wallet', wallet = state.projectState.activeWalletAddress);
};

olta.onUpdate(update);

each(($b) => $b.addEventListener('click', () => {
    orbit.reset(true);
    // Doesn't seem to work with the above reset.
    orbit.setLookAt(0, 0, orbitStart+orbit.minDistance, 0, 0, orbitStart, true);
  }),
  document.querySelectorAll('.recenter'));
