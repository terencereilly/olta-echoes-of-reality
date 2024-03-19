import { Olta } from '@olta/js-sdk';

import {
    WebGLRenderer, Scene, Raycaster, PerspectiveCamera, Clock,
    Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere,
    InstancedMesh, IcosahedronGeometry, MeshStandardMaterial,
    HemisphereLight, PointLight, Color, MathUtils, Fog, DoubleSide
  } from 'three';

import Stats from 'three/examples/jsm/libs/stats.module.js';
import CameraOrbitControls from 'camera-controls';

import { each } from '@epok.tech/fn-lists/each';

const { random, round } = Math;
const { MAX_SAFE_INTEGER: intMax } = Number;
const { lerp } = MathUtils;

const api = self.echoes = {};

const depths = api.depths = [1, 1e4];
const [near, far] = depths;

// Bounds are for maximum range and accuracy as `olta` only accepts integers.
const bounds = api.bounds = [-intMax, intMax];
// Bounds rescaled by this for front-end convenience with `three`.
const intScale = api.intScale = 1e-6;

const radii = api.radii = [1, 1e2];
const [r0, r1] = radii;

const colors = api.colors = {
  any: [0x00bbbb, 0xbb00bb, 0xbbbb00],
  own: [0x44ffff, 0xff44ff, 0xffff44]
};

const $body = api.$body = document.body;
const $canvas = api.$canvas = document.querySelector('canvas');

const size = new Vector2();

CameraOrbitControls.install({
  THREE: {
    WebGLRenderer, Raycaster,
    Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere
  }
});

const renderer = api.renderer =
  new WebGLRenderer({ canvas: $canvas, antialias: true });

renderer.setPixelRatio(devicePixelRatio);

const scene = api.scene = new Scene();
const clock = api.clock = new Clock();
const camera = api.camera = new PerspectiveCamera(60, 1, ...depths);
const orbit = api.orbit = new CameraOrbitControls(camera, $canvas);

orbit.infinityDolly = orbit.dollyToCursor = true;
orbit.dollyTo(orbit.minDistance = orbit.maxDistance = lerp(...depths, 0.2));

scene.fog = new Fog(0x000000, ...depths);

const lightCamera = api.lightCamera = new PointLight(0xffffff);

lightCamera.position.set(0, r1*2, 0);
scene.add(camera.add(lightCamera));

const lightSky = api.lightSky = new HemisphereLight(0xffffff, 0x000000, 3);

scene.add(lightSky);

const geometry = api.geometry = new IcosahedronGeometry(1, 3);
const material = api.material = new MeshStandardMaterial();

const transform = new Matrix4();
const color = new Color();
let forms;
let fl;

const raycaster = api.raycaster = new Raycaster();
const pointer = api.pointer = new Vector2(1, 1);
const axes = api.axes = new Vector2(1, -1);

stats = api.stats = new Stats();
$body.appendChild(stats.dom);

const render = api.render = () =>
  console.log('render', renderer.render(scene, camera));

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

  orbit.update(dt) && render();
  stats.update();
}

$canvas.addEventListener('pointermove', ({ clientX: x, clientY: y }) => {
  pointer.set(x, y).divide(size).multiplyScalar(2).subScalar(1).multiply(axes);
  raycaster.setFromCamera(pointer, camera);
  console.log('???', forms && raycaster.intersectObject(forms));
});

addEventListener('resize', resize);
resize();
frame();

const olta = api.olta = Olta();

const intToData = api.intToData = (int) => (int | 0)+'n';
const dataToInt = api.dataToInt = (data) => parseInt(data, 10);

const formToData = api.formToData = (form, to = {}) => {
  const { t, r, x, y, z } = form;

  to || (to = form);
  to.t = intToData(t);
  to.r = intToData(r);
  to.x = intToData(x);
  to.y = intToData(y);
  to.z = intToData(z);

  return to;
};

const dataToForm = api.dataToForm = (data, to = {}) => {
  const { t, r, x, y, z } = data;

  to || (to = data);
  to.t = dataToInt(t);
  to.r = dataToInt(r);
  to.x = dataToInt(x);
  to.y = dataToInt(y);
  to.z = dataToInt(z);

  return to;
};

const clearForms = api.clearForms = () =>
  fl = forms = forms?.removeFromParent?.().dispose?.();

const dataToScene = api.dataToScene = (data) => {
  // @todo Construct a KD-Tree, and only create enough meshes for nearby range.
  const dl = data.length;

  if(!dl) { return clearForms(); }
  else if((fl ?? 0) < dl) {
    clearForms();
    scene.add(forms = new InstancedMesh(geometry, material, fl = dl));
  }
  else { forms.count = dl; }

  each((d, i) => {
      const { t, r, x, y, z, _creator } = dataToForm(d, 0);
      const s = intScale;

      forms.setMatrixAt(i,
        transform.makeScale(r, r, r).setPosition(x*s, y*s, z*s));

      // @todo Alternate color for forms added by the same creator.
      forms.setColorAt(i,
        color.setHex(colors[(_creator === 'wallet')? 'own' : 'any'][t]));
    },
    data);

  forms.instanceMatrix.needsUpdate = forms.instanceColor.needsUpdate = true;
  render();
};

const update = api.update = (state) => {
  /**
   * @todo Check `state` settings to use dynamically?
   * @example ```
   * {
   *   collections: { forms: { ... } },
   *   configs: {
   *     forms: {
   *       name: 'forms',
   *       type: 'object',
   *       properties: {
   *         r: {
   *           max: '100',
   *           min: '1',
   *           name: 'r',
   *           type: 'bigint',
   *           update: 'set'
   *         },
   *         t: {
   *           max: '2',
   *           min: '0',
   *           name: 't',
   *           type: 'bigint',
   *           update: 'set'
   *         },
   *         x: {
   *           max: '9007199254740991',
   *           min: '-9007199254740991',
   *           name: 'x',
   *           type: 'bigint',
   *           update: 'set'
   *         },
   *         y: {
   *           max: '9007199254740991',
   *           min: '-9007199254740991',
   *           name: 'y',
   *           type: 'bigint',
   *           update: 'set'
   *         },
   *         z: {
   *           max: '9007199254740991',
   *           min: '-9007199254740991',
   *           name: 'z',
   *           type: 'bigint',
   *           update: 'set'
   *         }
   *       },
   *       permissions: {
   *         create: 'open',
   *         update: 'admin',
   *         createType: 'set',
   *         updateType: 'set'
   *       }
   *     }
   *   }
   * }
   * ```
   */

  const to = olta.getAll('forms');

  console.log('data', to, state);
  to && dataToScene(to);
  console.log('forms', forms);
};

olta.onUpdate(update);

// document.body.addEventListener('click', () =>
//   // @todo Check `state` settings to use dynamically, for limits etc?
//   olta.create('forms', formToData({
//       t: round(random()*colors.any.length),
//       r: round(lerp(...radii, random())),
//       x: round(lerp(...bounds, random())),
//       y: round(lerp(...bounds, random())),
//       z: round(lerp(...bounds, random()))
//     },
//     0)));
