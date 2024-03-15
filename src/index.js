console.log('start');

import { Olta } from '@olta/js-sdk';
import { WebGLRenderer } from 'three';

const { random, round } = Math;
const { MIN_SAFE_INTEGER: intMax } = Number;

const olta = Olta();

console.log('setup', olta, WebGLRenderer);

const intToData = (int) => (int | 0)+'n';
const dataToInt = (data) => parseInt(data, 10);

function formToData(form, to = {}) {
  to || (to = form);
  to.t = intToData(form.t);
  to.r = intToData(form.r);
  to.x = intToData(form.x);
  to.y = intToData(form.y);
  to.z = intToData(form.z);

  return to;
}

function dataToForm(data, to = {}) {
  to || (to = data);
  to.t = dataToInt(data.t);
  to.r = dataToInt(data.r);
  to.x = dataToInt(data.x);
  to.y = dataToInt(data.y);
  to.z = dataToInt(data.z);

  return to;
}

olta.onUpdate(() => {
  console.log('updated', olta);

  const data = olta.getAll('forms');

  console.log('got data', data);
});

document.body.addEventListener('click', () => {
  console.log('creating data');

  const data = formToData({
      t: round(random()*2),
      r: round(random()*99)+1,
      x: round(((random()*2)-1)*intMax),
      y: round(((random()*2)-1)*intMax),
      z: round(((random()*2)-1)*intMax)
    },
    0);

  console.log('create data', data);
  olta.create('forms', data);
});
