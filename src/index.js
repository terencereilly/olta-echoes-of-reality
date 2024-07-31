/**
 * @todo Intro and team selection interaction.
 * @todo Icons to explain `hunt`, `team`, `flee` interaction.
 * @todo Setup an admin mode to allow update/delete to moderate contributions.
 * @todo Address Terrence's Figma notes.
 * @todo Offset touch target to above fingertip so it's visible.
 * @todo Distinct touch interactions for moving target versus camera.
 * @todo Style updates according to Terrence's mood, colour, post references.
 * @todo Make camera move more consistently, especially dolly out...
 * @todo Replay time: add shapes in sequence (by `_sortKey` or `_id`?),
 *   on intro or idle.
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
    BufferGeometry, Mesh, Group, TextureLoader, NearestFilter,
    NumberKeyframeTrack, VectorKeyframeTrack,
    AnimationClip, AnimationMixer,
    InterpolateSmooth, InterpolateLinear,
    LoopOnce
  } from 'three';

import Stats from 'three/examples/jsm/libs/stats.module.js';
import CameraOrbitControls from 'camera-controls';

import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast }
  from 'three-mesh-bvh';

import { each } from '@epok.tech/fn-lists/each';
import { map } from '@epok.tech/fn-lists/map';
import { reduce } from '@epok.tech/fn-lists/reduce';
import { range } from '@epok.tech/fn-lists/range';

const gradientMapURL = new URL('assets/tone-5.jpg', import.meta.url);

const { random, round, floor, min, max, abs, acos, PI: pi } = Math;
const { MAX_SAFE_INTEGER: intMax, EPSILON: eps } = Number;
const { lerp, inverseLerp: unlerp, clamp } = MathUtils;

const api = self.echoes = {};

const cache = api.cache = {
  transform: new Matrix4(),
  colors: [new Color(), new Color()],
  spheres: [new Sphere()],
  vector3s: [new Vector3(), new Vector3(), new Vector3()]
};

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

const boundRadius = (intMax*positionScale)+r1;

const scales = api.scales = { growth: 1.5, shrink: 0.9, inner: 0.95, hit: 0.2 };

const colors = api.colors = {
  // any: [0x3033d4, 0xb02940, 0xefa53b],
  teams: [
    new Color('hsl(229, 82%, 46%)'),
    new Color('hsl(309, 72%, 38%)'),
    new Color('hsl(39, 95%, 48%)')
  ],
  // HSL offsets.
  own: [0, 0.2, 0],
  hunt: [0.05, 0, 0],
  flee: [-0.05, 0, 0],
  grow: [0, 0, 0.15]
};

const colorAt = (team, to = new Color()) => to.copy(colors.teams[team]);
const colorTo = (by, to = new Color()) => to.offsetHSL(...colors[by]);

const colorMix = (alpha, by, to = new Color(), c = new Color()) =>
  to.lerpHSL(colorTo(by, c.copy(to)), alpha);

const teams = api.teams = colors.teams.length;
const team = api.team = parseInt(query.get('team') || floor(random()*teams));
const hunt = (t) => (t+1)%teams;
const flee = (t) => (t+2)%teams;

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

orbit.maxSpeed = 1e3;
orbit.infinityDolly = orbit.dollyToCursor = true;
orbit.minDistance = orbit.maxDistance = r1;
orbit.dollySpeed = 10;
orbit.truckSpeed = 10;
orbit.setLookAt(0, 0, orbitStart+orbit.minDistance, 0, 0, orbitStart, true);
orbit.saveState();

// scene.fog = new Fog(0xffffff, ...depths);
scene.fog = new Fog(0x000000, ...depths);

const lightCamera = api.lightCamera = new PointLight(0xffffff, 5e4, 0, 1.7);

lightCamera.position.set(0, r1, 0);
scene.add(camera.add(lightCamera));

const lightSky = api.lightSky = new HemisphereLight(0xffffff, 0x000000, 0.5);

scene.add(lightSky);

const textureLoader = new TextureLoader();
const gradientMap = textureLoader.load(gradientMapURL);

gradientMap.minFilter = gradientMap.magFilter = NearestFilter;

const forms = api.forms = {
  geometry: new SphereGeometry(1),
  material: new MeshToonMaterial({ gradientMap }),
  data: [], meshes: [], limits: []
};

forms.geometry.computeBoundsTree();

function dataToSphere({ x, y, z, r }, s) {
  s.center.set(x, y, z).multiplyScalar(positionScale);
  s.radius = r;

  return s;
}

const hint = api.hint = {
  mesh: new Mesh(forms.geometry, new MeshToonMaterial({
    transparent: true, opacity: 0.4, side: DoubleSide, depthWrite: false,
    color: colorTo('own', colorAt(team)), gradientMap
  })),
  radius: 1, ease: 1e1,
  tween(dt) {
    const { radius: r, ease: e, mesh: { scale: s } } = hint;
    const sr = s.x;

    s.setScalar(sr+((r-sr)*e*dt));
  }
};

const hold = api.hold = {
  mesh: new Mesh(hint.mesh.geometry, hint.mesh.material.clone()),
  frames: {}, wait: 1e3,
  at: new Vector2(), moved2: 20
};

scene.add(hint.mesh.add(hold.mesh));

(function animateHold() {
  const { mesh, frames, wait } = hold;
  const mixer = hold.mixer = new AnimationMixer(mesh);
  const { material, scale } = mesh;
  const times = [0, wait*1e-3];

  const fo = frames.opacity = new NumberKeyframeTrack('.material.opacity',
    times, [1, material.opacity*0.1], InterpolateSmooth);

  const fs = frames.scale = new VectorKeyframeTrack('.scale',
    times, scale.toArray(range(6, eps), 3), InterpolateSmooth);

  const clip = hold.clip = new AnimationClip('@', -1, [fs, fo]);
  const action = hold.action = mixer.clipAction(clip);

  action.setLoop(LoopOnce, 1);
})();

const hit = api.hit = new Mesh(new CylinderGeometry(0.1, 0.5, 1, 2**5, 1, true),
  new MeshToonMaterial({
    transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false,
    color: hint.mesh.material.color.clone(), fog: false, gradientMap
  }));

hit.visible = false;
hit.geometry.translate(0, 0.5, 0);
hit.geometry.rotateX(pi*0.5);
scene.add(hit);

const traces = api.traces = {
  group: new Group(),
  mesh: new Mesh(forms.geometry,
    new MeshToonMaterial({
      transparent: true, opacity: 0.6, side: DoubleSide, depthWrite: false,
      color: hint.mesh.material.color.clone(), fog: false, gradientMap
    })),
  frames: { drawRangeSpeed: 1 }
};

// @todo Work out how to animate the `drawRange` here... can't parse the path.
// @todo Animate the clip planes of the `hint`.
(function animateTrace() {
  const { mesh, frames } = traces;
  const mixer = traces.mixer = new AnimationMixer(mesh);
  const o1 = mesh.material.opacity;
  const o0 = o1*0.5;

  const fo = frames.opacity = new NumberKeyframeTrack('.material.opacity',
    [0, 0.9, 1.6], [o0, o1, o0], InterpolateSmooth);

  const clip = traces.clip = new AnimationClip('@', -1, [fo]);

  (traces.action = mixer.clipAction(clip)).play();
})();

function toTrace(x, y, z, r) {
  const { mesh, group } = traces;
  const t = mesh.clone();
  const { position: p, scale: s, material } = t;

  p.set(x, y, z);
  s.multiplyScalar(r*scales.inner);
  material.color.copy(hint.mesh.material.color);
  // @todo Track the time it was added, to remove when its data arrives?
  group.add(t);

  return t;
}

scene.add(traces.group);

const raycaster = api.raycaster = new Raycaster();

raycaster.firstHitOnly = true;

const pointer = new Vector2();
const axes = new Vector2(1, -1);

const stats = api.stats = ((query.has('stats'))? new Stats() : null);

stats && $body.appendChild(stats.dom);

// let needRender = false;
const needRender = true;

const render = api.render = (dt = 0) => {
  // console.log('render');
  hold.mixer.update(dt);
  traces.mixer.update(dt);
  hint.tween(dt);
  renderer.render(scene, camera);

  // const { geometry: g, frames: { drawRangeSpeed: drs } } = traces;
  // const { drawRange: { start: ds0, count: dc0 }, index: { count: gc } } = g;
  // const to = gc*0.3*drs*dt;
  // const ds1 = (ds0+to)%gc;
  // const dc1 = (dc0+to)%gc;

  // g.setDrawRange(min(ds1, dc1), max(ds1, dc1));

  // needRender = false;
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

  (orbit.update(dt) || needRender) && render(dt);
  stats?.update?.();
};

const clearHeld = api.clearHeld = () => {
  const { held, action, mesh } = hold;

  action.stop();
  mesh.visible = false;
  clearTimeout(held);
  delete hold.held;

  return held;
};

$canvas.addEventListener('pointerup', clearHeld);
$canvas.addEventListener('pointercancel', clearHeld);
$canvas.addEventListener('pointerout', clearHeld);
$canvas.addEventListener('pointerleave', clearHeld);

$canvas.addEventListener('pointermove', (e) => {
  const { held, at, moved2 } = hold;

  held && (at.distanceToSquared(e) > moved2) && clearHeld();
});

// @todo Animate hint color over time.
$canvas.addEventListener('pointerdown', (e) => {
  const { mesh, wait, action, at } = hold;

  clearHeld();
  mesh.material.color.copy(hint.mesh.material.color);
  mesh.visible = true;
  action.play();
  at.copy(e);

  hold.held = setTimeout(() => {
      if(!clearHeld()) { return; }

      const { radius: r, mesh: { visible: hv, position: hp } } = hint;

      if(!r || !hv) { return; }

      const { x, y, z } = hp;
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
      mesh.visible = false;
      hint.radius = 0;
      // needRender = true;
    },
    wait);
});

$canvas.addEventListener('pointermove', (e) => {
  const { data } = forms;

  // needRender = true;

  if(!data?.length) { return hint.radius = +(hit.visible = false); }

  pointer.copy(e).divide(size).multiplyScalar(2).subScalar(1).multiply(axes);
  raycaster.setFromCamera(pointer, camera);

  const { ray, ray: { origin: ro } } = raycaster;
  const { spheres: [s], vector3s: [p, v, c], colors: [color] } = cache;
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

  if(l2 === Infinity) { return hint.radius = +(hit.visible = false); }

  const { t } = at;
  let ar = at.r;
  const { growth: sg, shrink: ss, hit: sh } = scales;
  const hitColor = hit.material.color;

  hit.lookAt(v.copy(hit.position.copy(p)).add(p).sub(c));
  hit.visible = true;

  if(t !== team) {
    // colorTo(((t === hunt(team))? 'hunt' : 'flee'),
    //   colorTo('own', colorAt(team, hitColor)));
    colorTo('own', colorAt(team, hitColor));
    hit.scale.setScalar(ar*sh);

    return hint.radius = 0;
  }

  // Check the other team forms intersected:
  // - Increase radius if touching a team to `hunt`.
  // - Decrease radius to avoid touching a team to `flee`.
  const { [hunt(team)]: dh, [flee(team)]: df } = data;
  let r = ar = max(ar*ss, r0);

  // Check `hunt` first, increase radius if touched, proportional to how much of
  // each form (radius) is crossed.
  // @todo Optimise using squared-distance comparisons.
  r *= min(sg,
    reduce((to, d) =>
        to+max(min(r-dataToSphere(d, s).distanceToPoint(p), s.radius, r)/r, 0),
      dh, 1));

  // Check `flee` and decrease radius to nearest touch.
  // @todo Optimise using squared-distance comparisons.
  r = reduce((to, d) => min(to, dataToSphere(d, s).distanceToPoint(p)), df, r);

  // @todo Animate hint radius over time.
  if(r < r0) { return hint.radius = 0; }

  const hintColor = colorAt(team, hint.mesh.material.color);

  if(r === ar) { hitColor.setHex(0); }
  else {
    colorTo(((r < ar)? 'flee' : 'hunt'), hintColor);
    colorAt(((r < ar)? flee : hunt)(team), hitColor);
  }

  r = min(r, r1);
  colorMix(unlerp(...radii, r), 'grow', hintColor, color);
  hint.radius = r;
  hint.mesh.position.copy(p);
  hint.visible = true;
  hit.scale.setScalar(r*sh);
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
  const { transform, colors: [c0, c1] } = cache;

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

          colorAt(t, c0);
          (_creator === wallet) && colorTo('own', c0);
          colorMix(unlerp(...radii, r), 'grow', c0, c1);
          m.setColorAt(i, c0);
        },
        d);

      m.instanceMatrix.needsUpdate = m.instanceColor.needsUpdate = true;
    },
    data);

  // needRender = true;
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
    // orbit.setLookAt(0, 0, orbitStart+orbit.minDistance, 0, 0, orbitStart, true);
  }),
  document.querySelectorAll('.recenter'));
