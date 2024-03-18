import { Olta } from '@olta/js-sdk';

import {
    WebGLRenderer, Scene, Raycaster, PerspectiveCamera, Clock,
    Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere,
    InstancedMesh, IcosahedronGeometry, MeshStandardMaterial,
    HemisphereLight, PointLight, Color, MathUtils
  } from 'three';

// import { Stats } from 'three/addons/libs/stats.module.js';
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
const intScale = api.intScale = 1e-13;

const radii = api.radii = [1, 1e2];
const [r0, r1] = radii;

const colors = api.colors = {
  any: [0xff0000, 0x00ff00, 0x0000ff],
  own: [0xff6666, 0x66ff66, 0x6666ff]
};

const $body = api.$body = document.body;
const $canvas = api.$canvas = document.querySelector('canvas');

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
const camera = api.camera = new PerspectiveCamera(60, 1, ...depths);
const orbit = api.orbit = new CameraOrbitControls(camera, $canvas);

camera.position.set(0, 0, lerp(...depths, 0.5));
camera.lookAt(0, 0, 0);

orbit.minDistance = near;
orbit.maxDistance = far;
orbit.infinityDolly = true;

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
const mouse = api.mouse = new Vector2(1, 1);
const clock = api.clock = new Clock();

// stats = api.stats = new Stats();
// $body.appendChild(stats.dom);

const render = api.render = () =>
  console.log('render', renderer.render(scene, camera));

const resize = api.resize = () => {
  const { width: w, height: h } = $canvas.getBoundingClientRect();

  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, 0);
  render();
};

const frame = api.frame = () => {
  requestAnimationFrame(frame);

  const dt = clock.getDelta();

  orbit.update(dt) && render();
  // stats.update();
}

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
  const dl = data?.length ?? 0;

  if(!dl) { return clearForms(); }
  else if((fl ?? 0) < dl) {
    clearForms();
    scene.add(forms = new InstancedMesh(geometry, material, fl = dl));
  }
  else { forms.count = dl; }

  each((d, i) => {
      const { t, r, x, y, z, _creator } = dataToForm(d, 0);
      const bs = intScale;

      forms.setMatrixAt(i,
        transform.makeScale(r, r, r).setPosition(x*bs, y*bs, z*bs));

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
  dataToScene(to);
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
