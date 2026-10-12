/*
 * 原作：靈 © 2024-01-30 Zaron Chen / CC BY-NC-SA 3.0
 * https://creativecommons.org/licenses/by-nc-sa/3.0/
 * 在原项目16帧马形基础上修改：默认奔跑，滑过局部游散，延迟归位。
 */
const HORSE_SETTINGS = {
  particles: 100000,
  size: 720,
  strideSeconds: 0.85,
  mouseRadius: 48,       // 影响半径，按720像素画布计算
  freeSeconds: 3,        // 被碰到后自由游动的秒数
  returnSeconds: 1.25,   // 随后逐渐归位的秒数
  trailAlpha: 0.25       // 越小拖尾越长
};

function setup() {

  try {
    startHorse();
  } catch (error) {
    console.error(error);

    const box = document.createElement('pre');
    box.style.cssText =
      'color:white;padding:20px;white-space:pre-wrap';
    box.textContent = '启动失败：' + error.message;
    document.body.appendChild(box);
  }
}

function startHorse() {
  const cfg = HORSE_SETTINGS;

  document.body.style.cssText =
    'margin:0;background:black;display:grid;place-items:center;min-height:100vh';

  const view = document.createElement('canvas');
  view.width = view.height = cfg.size;
  view.style.cssText =
    'display:block;width:min(100vw,100vh);height:min(100vw,100vh);touch-action:none';

  document.body.appendChild(view);

  const ctx = view.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cfg.size, cfg.size);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cfg.size;

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true
  });

  if (!gl) {
    throw new Error(
      '浏览器未开启 WebGL2，请开启硬件加速后重试。'
    );
  }

  // 保留原项目的轮廓、采样方法和头颈微调。
  const mask = document.createElement('canvas');
  mask.width = 384;
  mask.height = 260;

  const mc = mask.getContext('2d', {
    willReadFrequently: true
  });

  const samples = 4096;
  const frames = HORSE_POSES.length;
  const targets = new Float32Array(samples * frames * 2);

  HORSE_POSES.forEach((contours, f) => {
    mc.clearRect(0, 0, 384, 260);
    mc.beginPath();

    for (const poly of contours) {
      mc.moveTo(poly[0], poly[1]);

      for (let k = 2; k < poly.length; k += 2) {
        mc.lineTo(poly[k], poly[k + 1]);
      }

      mc.closePath();
    }

    mc.fillStyle = '#fff';
    mc.fill('evenodd');

    const pixels = mc.getImageData(0, 0, 384, 260).data;
    const runs = [];
    let area = 0;

    for (let x = 0; x < 384; x++) {
      let begin = -1;

      for (let y = 0; y <= 260; y++) {
        const inside =
          y < 260 &&
          pixels[(y * 384 + x) * 4 + 3] > 128;

        if (inside && begin < 0) {
          begin = y;
        }

        if (!inside && begin >= 0) {
          runs.push(x, begin, y);
          area += y - begin;
          begin = -1;
        }
      }
    }

    let j = 0;
    let offset = 0;

    for (let i = 0; i < samples; i++) {
      const rank = (i + 0.5) * area / samples;

      while (
        j + 3 < runs.length &&
        offset + runs[j + 2] - runs[j + 1] <= rank
      ) {
        offset += runs[j + 2] - runs[j + 1];
        j += 3;
      }

      const at = (f * samples + i) * 2;

      targets[at] =
        (runs[j] + 0.5 - 180) / 180 * 0.95;

      targets[at + 1] =
        -(runs[j + 1] + rank - offset - 125) / 180 * 0.95;
    }
  });

  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  for (const key of [
    gl.TEXTURE_MIN_FILTER,
    gl.TEXTURE_MAG_FILTER
  ]) {
    gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
  }

  for (const key of [
    gl.TEXTURE_WRAP_S,
    gl.TEXTURE_WRAP_T
  ]) {
    gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
  }

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RG32F,
    samples,
    frames,
    0,
    gl.RG,
    gl.FLOAT,
    targets
  );

  const updateVS = `#version 300 es
precision highp float;

layout(location=0) in vec2 aPosition;
layout(location=1) in float aAge;
layout(location=2) in float aLife;
layout(location=3) in vec2 aVel;
layout(location=4) in float aRelease;

uniform float uTime, uDt, uPose, uRadius, uFree, uReturn;
uniform int uStrokeCount;
uniform vec4 uStrokes[8];
uniform vec2 uRandom;
uniform highp sampler2D uTargets;

out vec2 vPosition;
out float vAge, vLife;
out vec2 vVel;
out float vRelease;

${HORSE_NOISE}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 d = b-a;
  float t = clamp(
    dot(p-a,d)/max(dot(d,d),0.000001),
    0.,
    1.
  );
  return length(p-a-d*t);
}

void main() {
  float dt = uDt;
  float stepFrames = dt*60.;

  vec2 rnd = hash22(
    vec2(gl_VertexID%512,gl_VertexID/512)
  );

  bool isHorse = rnd.x >= .025;

  int count = textureSize(uTargets,0).y;
  int f = int(floor(uPose))%count;
  int id = gl_VertexID%4096;

  vec2 h0 = texelFetch(
    uTargets,ivec2(id,f),0
  ).rg;

  vec2 h1 = texelFetch(
    uTargets,ivec2(id,(f+1)%count),0
  ).rg;

  vec2 horse = mix(h0,h1,fract(uPose));

  horse += (rnd-.5)*.009;

  horse += vec2(
    sin(uTime*2.+rnd.x*50.),
    cos(uTime*2.+rnd.y*50.)
  )*.0015;

  // 每个粒子独立记录最后一次被碰到的时间。
  bool touched = false;

  if (isHorse) {
    for (int i=0;i<8;i++) {
      if (i>=uStrokeCount) break;

      if (
        segmentDistance(
          aPosition,
          uStrokes[i].xy,
          uStrokes[i].zw
        ) < uRadius
      ) {
        touched = true;
      }
    }
  }

  vRelease = touched ? uTime : aRelease;

  float since = uTime-vRelease;

  float weight = isHorse
    ? smoothstep(uFree,uFree+uReturn,since)
    : 0.;

  vec2 n = vec2(
    .5+.5*snoise(
      vec3(aPosition*10.+200.,uTime*.5)
    ),
    .5+.5*snoise(
      vec3(aPosition*10.+100.,uTime*.5)
    )
  );

  vec2 velocity = aVel;

  if (
    touched &&
    uTime-aRelease > uFree+uReturn
  ) {
    velocity += (2.*n-1.)*.3;
  }

  // 保留原作的噪声流场运动。
  vec2 force = 3.*(2.*n-1.);
  float damping = pow(.95,stepFrames);

  vVel =
    damping*velocity +
    force*(1.-damping);

  vPosition = aPosition + velocity*dt;
  vLife = aLife;
  vAge = aAge+dt;

  if (vAge>=aLife) {
    vAge = mod(vAge,aLife);

    // 马身粒子寿命结束时只更新亮度，
    // 不把它瞬移到画面的其他位置。
    if (!isHorse) {
      float x = snoise(
        vec3(
          rnd+uRandom.x,
          -uTime*.1+n.x*.1
        )
      );

      float y = snoise(
        vec3(
          rnd-uRandom.y,
          uTime*.1+n.y*.1
        )
      );

      vPosition = .75*vec2(x,y);
      vVel = vPosition;
    }
  }

  // 等待结束后，逐渐追上当前正在奔跑的马形。
  vec2 continuous = mix(
    vPosition,
    aPosition,
    weight
  );

  float follow =
    1.-pow(
      max(1.-weight*.62,.0001),
      stepFrames
    );

  vPosition = mix(
    continuous,
    horse,
    follow
  );

  vVel *= pow(
    1.-weight*.15,
    stepFrames
  );

  gl_Position = vec4(vPosition,0.,1.);
}`;

  const updateFS = `#version 300 es
precision highp float;
out vec4 color;

void main() {
  color=vec4(0.);
}`;

  const renderVS = `#version 300 es
precision highp float;

layout(location=0) in vec2 aPosition;
layout(location=1) in float aAge;
layout(location=2) in float aLife;

out float lifeRatio;

void main() {
  lifeRatio=aAge/aLife;
  gl_PointSize=max(1.-lifeRatio,1.);
  gl_Position=vec4(aPosition,0.,1.);
}`;

  const renderFS = `#version 300 es
precision highp float;

in float lifeRatio;
out vec4 color;

void main() {
  color=vec4(max(1.-2.*lifeRatio,0.));
}`;

  function compile(type, source) {
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }

    return shader;
  }

  function program(vs, fs, feedback) {
    const p = gl.createProgram();

    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));

    if (feedback) {
      gl.transformFeedbackVaryings(
        p,
        [
          'vPosition',
          'vAge',
          'vLife',
          'vVel',
          'vRelease'
        ],
        gl.INTERLEAVED_ATTRIBS
      );
    }

    gl.linkProgram(p);

    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }

    return p;
  }

  const update = program(updateVS, updateFS, true);
  const render = program(renderVS, renderFS, false);

  const u = {};

  for (const name of [
    'uTime',
    'uDt',
    'uPose',
    'uRadius',
    'uFree',
    'uReturn',
    'uStrokeCount',
    'uStrokes[0]',
    'uRandom',
    'uTargets'
  ]) {
    u[name] = gl.getUniformLocation(update, name);
  }

  gl.useProgram(update);

  gl.uniform1i(u.uTargets, 0);

  gl.uniform2f(
    u.uRandom,
    Math.random()*1024,
    Math.random()*1024
  );

  gl.uniform1f(
    u.uRadius,
    cfg.mouseRadius/cfg.size*2
  );

  gl.uniform1f(u.uFree, cfg.freeSeconds);
  gl.uniform1f(u.uReturn, cfg.returnSeconds);

  // 第一帧就放到马形上，不必等待粒子逐渐出生。
  const data = new Float32Array(cfg.particles*7);

  for (let i=0; i<cfg.particles; i++) {
    const k = i*7;
    const t = (i%samples)*2;
    const life = 1.01+Math.random()*1.14;

    data[k] =
      targets[t]+(Math.random()-.5)*.009;

    data[k+1] =
      targets[t+1]+(Math.random()-.5)*.009;

    data[k+2] = Math.random()*life;
    data[k+3] = life;
    data[k+6] = -1000;
  }

  const buffers = [];
  const vaos = [];

  for (let i=0; i<2; i++) {
    const b = gl.createBuffer();
    const vao = gl.createVertexArray();

    buffers.push(b);
    vaos.push(vao);

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);

    for (const [loc, size, offset] of [
      [0,2,0],
      [1,1,8],
      [2,1,12],
      [3,2,16],
      [4,1,24]
    ]) {
      gl.enableVertexAttribArray(loc);

      gl.vertexAttribPointer(
        loc,
        size,
        gl.FLOAT,
        false,
        28,
        offset
      );
    }
  }

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  const feedback = gl.createTransformFeedback();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, cfg.size, cfg.size);

  // 用线段记录滑动路径，快速划过时也能触发。
  const strokes = [];
  let previous = null;

  function pointer(event) {
    const r = view.getBoundingClientRect();

    return [
      (event.clientX-r.left)/r.width*2-1,
      1-(event.clientY-r.top)/r.height*2
    ];
  }

  view.addEventListener('pointerenter', e => {
    previous = pointer(e);
  });

  view.addEventListener('pointerleave', () => {
    previous = null;
  });

  view.addEventListener('pointercancel', () => {
    previous = null;
  });

  view.addEventListener('pointermove', e => {
    const p = pointer(e);

    if (
      previous &&
      Math.hypot(
        p[0]-previous[0],
        p[1]-previous[1]
      ) > .0001
    ) {
      if (strokes.length < 8) {
        strokes.push([...previous, ...p]);
      } else {
        strokes[7][2] = p[0];
        strokes[7][3] = p[1];
      }
    }

    previous = p;
  });

  const strokeData = new Float32Array(32);

  let read = 0;
  let time = 0;
  let last = performance.now();

  function animate(now) {
    const dt = Math.min(
      Math.max((now-last)/1000, .001),
      .05
    );

    last = now;
    time += dt;

    gl.useProgram(update);

    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uDt, dt);

    gl.uniform1f(
      u.uPose,
      (time/cfg.strideSeconds*frames)%frames
    );

    strokeData.fill(0);

    strokes.forEach((s, i) => {
      strokeData.set(s, i*4);
    });

    gl.uniform1i(u.uStrokeCount, strokes.length);
    gl.uniform4fv(u['uStrokes[0]'], strokeData);

    strokes.length = 0;

    gl.bindVertexArray(vaos[read]);

    gl.bindTransformFeedback(
      gl.TRANSFORM_FEEDBACK,
      feedback
    );

    gl.bindBufferBase(
      gl.TRANSFORM_FEEDBACK_BUFFER,
      0,
      buffers[1-read]
    );

    gl.enable(gl.RASTERIZER_DISCARD);

    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, cfg.particles);
    gl.endTransformFeedback();

    gl.disable(gl.RASTERIZER_DISCARD);

    gl.bindBufferBase(
      gl.TRANSFORM_FEEDBACK_BUFFER,
      0,
      null
    );

    gl.bindTransformFeedback(
      gl.TRANSFORM_FEEDBACK,
      null
    );

    read = 1-read;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(render);
    gl.bindVertexArray(vaos[read]);
    gl.drawArrays(gl.POINTS, 0, cfg.particles);
    gl.bindVertexArray(null);

    const fade =
      1-Math.pow(1-cfg.trailAlpha, dt*60);

    ctx.fillStyle = 'rgba(0,0,0,'+fade+')';
    ctx.fillRect(0, 0, cfg.size, cfg.size);
    ctx.drawImage(canvas, 0, 0);

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

// 内置原项目的噪声函数，不需要额外联网导入。
const HORSE_NOISE = `
vec3 mod289(vec3 x) {
  return x-floor(x*(1.0/289.0))*289.0;
}
vec4 mod289(vec4 x) {
  return x-floor(x*(1.0/289.0))*289.0;
}
vec4 permute(vec4 x) {
  return mod289(((x*34.0)+10.0)*x);
}
vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159-0.85373472095314*r;
}

/*
Description : Array and textureless GLSL 3D simplex noise functions.
Author : Ian McEwan, Ashima Arts.
Maintainer : stegu
Lastmod : 20201014 (stegu)
License : Copyright (C) 2011 Ashima Arts. All rights reserved.
Distributed under the MIT License.
https://github.com/ashima/webgl-noise
https://github.com/stegu/webgl-noise

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0,1.0/3.0);
  const vec4 D = vec4(0.0,0.5,1.0,2.0);

  vec3 i = floor(v+dot(v,C.yyy));
  vec3 x0 = v-i+dot(i,C.xxx);

  vec3 g = step(x0.yzx,x0.xyz);
  vec3 l = 1.0-g;
  vec3 i1 = min(g.xyz,l.zxy);
  vec3 i2 = max(g.xyz,l.zxy);

  vec3 x1 = x0-i1+C.xxx;
  vec3 x2 = x0-i2+C.yyy;
  vec3 x3 = x0-D.yyy;

  i = mod289(i);

  vec4 p = permute(
    permute(
      permute(
        i.z+vec4(0.0,i1.z,i2.z,1.0)
      )+i.y+vec4(0.0,i1.y,i2.y,1.0)
    )+i.x+vec4(0.0,i1.x,i2.x,1.0)
  );

  float n_ = 0.142857142857;
  vec3 ns = n_*D.wyz-D.xzx;

  vec4 j = p-49.0*floor(p*ns.z*ns.z);
  vec4 x_ = floor(j*ns.z);
  vec4 y_ = floor(j-7.0*x_);

  vec4 x = x_*ns.x+ns.yyyy;
  vec4 y = y_*ns.x+ns.yyyy;
  vec4 h = 1.0-abs(x)-abs(y);

  vec4 b0 = vec4(x.xy,y.xy);
  vec4 b1 = vec4(x.zw,y.zw);

  vec4 s0 = floor(b0)*2.0+1.0;
  vec4 s1 = floor(b1)*2.0+1.0;
  vec4 sh = -step(h,vec4(0.0));

  vec4 a0 = b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw+s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(
    vec4(
      dot(p0,p0),
      dot(p1,p1),
      dot(p2,p2),
      dot(p3,p3)
    )
  );

  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(
    0.5-vec4(
      dot(x0,x0),
      dot(x1,x1),
      dot(x2,x2),
      dot(x3,x3)
    ),
    0.0
  );

  m = m*m;

  return 105.0*dot(
    m*m,
    vec4(
      dot(p0,x0),
      dot(p1,x1),
      dot(p2,x2),
      dot(p3,x3)
    )
  );
}

/*
Copyright (c)2014 David Hoskins.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

vec2 hash22(vec2 p) {
  vec3 p3 = fract(
    vec3(p.xyx)*vec3(.1031,.1030,.0973)
  );
  p3 += dot(p3,p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
`;

// 原项目的16帧马匹轮廓，必须完整保留。
const HORSE_POSES = [
  [[260,50,261,55,266,53,263,61,271,68,286,91,282,97,274,99,270,93,251,85,239,107,236,127,249,130,255,135,255,146,258,155,257,173,251,171,248,166,250,162,247,159,249,143,246,138,239,139,245,144,245,152,230,162,217,159,212,154,219,151,232,153,236,150,236,147,217,143,181,144,164,142,167,158,189,171,184,174,185,176,157,163,151,145,144,140,137,162,137,179,143,190,150,193,150,195,139,196,125,171,128,156,127,148,113,129,110,119,97,116,86,122,75,124,56,140,48,140,46,133,49,131,49,127,64,127,70,118,79,112,79,108,86,103,99,100,118,101,134,92,185,93,191,87,196,86,198,81,208,81,208,75,202,70,204,68,210,69,207,63,217,68,214,63,218,59,237,56,238,53,258,55]],

  [[262,52,264,52,264,57,268,55,266,63,276,73,288,92,283,99,276,100,269,92,252,85,240,107,238,128,251,132,258,137,262,148,268,155,272,172,263,169,262,163,258,160,258,150,254,144,247,149,242,158,225,161,225,157,229,152,233,151,235,153,235,151,242,148,245,143,244,140,202,144,161,142,169,163,189,178,184,180,183,183,158,165,151,149,139,141,129,153,119,171,122,190,128,195,117,196,109,164,114,159,118,148,110,130,108,117,103,120,97,116,86,122,76,123,65,129,53,143,48,142,51,139,45,137,45,134,61,128,85,104,119,102,134,94,183,95,194,88,197,83,206,83,208,81,205,75,210,72,205,71,204,68,219,68,222,63,229,64,230,61,226,57,240,59,241,53,261,56]],

  [[267,55,269,60,273,58,270,65,281,77,292,96,288,102,281,104,271,94,259,87,255,88,243,107,242,125,261,128,263,135,259,147,268,156,286,166,289,169,287,172,280,173,258,155,256,155,254,165,251,167,247,161,250,151,224,141,189,146,154,142,152,152,156,177,162,187,170,193,167,196,161,196,144,173,140,152,132,144,124,148,100,172,94,186,95,195,91,196,86,194,86,188,94,172,96,161,108,147,108,117,106,116,103,122,94,118,66,128,53,139,47,148,45,148,45,143,41,141,46,141,51,136,49,132,56,130,56,128,79,115,84,108,109,103,122,103,135,97,167,100,183,99,200,85,209,83,204,78,214,77,214,73,208,73,209,71,214,71,222,66,238,67,246,65,248,61,250,62,248,56,266,59],[251,134,247,136,251,142,254,142,255,139,255,134]],

  [[251,57,264,60,271,57,271,61,275,60,273,68,283,78,294,95,292,102,284,106,274,96,262,89,258,89,246,106,246,124,262,125,266,128,268,132,267,157,269,167,288,175,285,180,279,181,278,178,270,176,260,165,254,163,234,145,226,141,202,146,174,146,151,140,134,172,134,180,146,196,136,196,123,174,123,169,129,159,129,150,126,145,123,145,113,151,92,172,80,194,77,194,76,183,83,177,91,160,104,144,107,117,100,121,98,121,99,118,93,118,70,126,56,134,45,145,44,149,41,149,41,146,49,136,48,131,53,130,54,127,58,127,68,119,79,116,85,110,103,104,123,103,136,98,162,101,185,100,202,84,209,82,210,80,206,79,209,79,216,70,223,68,223,66,250,66,254,62],[257,133,245,138,256,152,261,157,259,155,261,137]],

  [[254,58,268,61,272,58,273,62,277,60,274,68,297,96,294,104,286,107,285,103,278,98,267,94,265,91,259,91,248,105,248,125,267,128,271,131,279,151,282,167,273,163,273,157,270,156,270,145,265,136,242,139,241,141,258,171,268,181,274,183,278,189,268,191,267,188,264,188,256,175,224,143,197,147,176,146,151,138,148,138,146,143,122,167,118,179,124,196,115,196,110,169,110,165,120,154,121,147,114,149,91,167,78,184,68,185,70,179,83,169,89,157,103,144,106,129,105,117,101,120,94,118,53,134,44,143,42,149,41,143,46,135,45,131,61,124,64,120,76,118,109,103,134,99,166,102,186,100,201,89,216,70,231,67,253,67,256,64]],

  [[272,60,274,60,274,63,278,62,276,70,287,79,301,95,301,98,295,107,291,107,288,102,268,93,261,95,250,111,250,130,290,153,303,165,292,166,283,156,265,147,234,143,234,161,238,183,244,193,251,195,236,196,232,179,218,147,181,147,148,137,141,139,134,146,127,149,106,171,104,177,98,193,96,193,90,187,109,152,91,160,77,176,68,177,68,174,72,167,77,166,87,156,91,148,101,145,109,138,109,116,105,119,94,120,74,128,61,129,43,136,41,136,42,131,64,123,68,119,89,114,117,100,138,97,151,97,169,101,189,100,203,90,210,90,210,86,215,86,218,79,222,80,221,76,225,77,224,72,236,72,236,69,247,71,258,68,260,66,259,62,271,63]],

  [[272,59,274,62,277,61,275,69,284,75,303,95,297,105,293,105,291,101,281,97,271,94,264,95,249,116,250,134,281,160,302,166,302,171,295,173,293,170,285,169,280,164,267,160,246,147,232,144,223,150,217,178,218,191,226,196,211,196,210,149,177,146,152,135,143,136,128,145,122,153,108,164,97,181,88,186,89,180,87,178,93,174,104,154,109,150,104,149,94,155,84,173,76,175,77,167,85,161,94,141,113,135,114,125,111,116,105,120,97,120,74,128,48,129,41,128,41,126,88,115,108,101,120,97,152,95,177,100,191,99,205,90,216,88,223,80,225,81,228,74,237,75,258,70,262,67,261,63,270,64]],

  [[271,59,275,61,274,68,285,75,303,93,301,99,295,103,288,98,272,93,265,95,249,116,249,137,269,166,282,178,293,183,290,187,283,188,241,148,229,145,216,150,208,161,197,186,198,191,203,196,190,196,189,189,195,176,195,168,202,149,177,145,155,135,147,135,142,140,127,146,123,151,107,160,93,176,89,176,88,166,93,162,97,138,116,133,116,117,109,118,106,122,106,118,104,118,96,123,73,129,47,124,46,119,50,122,66,122,70,121,67,119,88,116,104,102,123,95,154,93,174,98,192,98,208,89,216,88,228,77,239,77,259,69,264,63,270,63],[107,147,102,150,102,155]],

  [[269,57,271,60,273,59,272,67,299,87,300,92,297,99,294,100,280,94,266,92,260,97,254,110,247,118,245,136,241,142,242,165,249,190,260,196,244,196,230,152,226,147,212,151,196,172,187,178,172,196,166,196,165,191,168,187,171,187,171,181,176,180,187,171,198,147,176,143,158,134,153,134,149,141,140,143,115,149,119,170,112,177,112,172,109,171,111,167,109,155,99,171,92,170,95,167,93,164,97,162,106,145,105,138,120,133,119,118,112,122,107,120,100,125,80,130,69,130,60,125,55,125,50,118,60,122,69,122,71,119,86,119,91,117,96,108,103,102,118,96,138,92,150,91,180,97,198,96,211,89,211,86,218,86,222,80,243,76,253,67,268,61]],

  [[265,56,267,59,269,58,269,67,278,71,298,88,293,98,269,91,260,93,254,109,244,122,237,143,230,147,227,156,225,188,228,193,236,196,220,196,219,194,215,151,209,155,196,177,175,184,160,182,160,180,167,175,183,176,188,174,193,168,198,147,171,140,159,133,155,134,152,141,124,147,122,149,123,153,132,167,129,177,127,178,126,172,123,171,123,163,116,151,114,151,111,169,104,173,104,163,106,162,110,137,124,133,120,122,114,118,99,128,74,132,53,124,55,121,51,117,61,122,88,120,95,108,101,103,120,95,140,91,197,96,210,90,209,86,213,85,213,83,219,83,218,79,242,75,253,65,263,61]],

  [[263,54,264,58,267,57,267,65,280,72,296,85,294,93,285,96,283,93,266,89,260,92,254,108,238,130,236,141,224,148,214,162,206,184,206,190,213,196,199,196,198,189,202,177,167,174,168,169,174,165,183,169,198,171,199,147,197,145,160,132,157,139,137,143,131,149,134,156,143,165,145,166,145,176,136,171,135,164,124,154,125,168,120,173,120,168,117,166,115,136,129,132,123,127,118,116,96,131,81,133,65,131,55,124,55,120,62,123,89,122,95,107,102,102,116,96,130,95,142,90,157,90,185,95,199,94,211,88,210,84,216,84,212,81,216,80,216,78,239,75,256,60,260,60]],

  [[264,50,265,53,268,52,267,60,294,83,292,90,283,94,278,89,261,85,252,104,241,119,235,137,220,146,223,166,218,170,211,169,198,172,186,187,183,196,179,196,177,191,177,188,181,186,180,179,193,169,184,164,191,159,197,161,204,144,178,136,169,130,166,130,159,137,150,139,145,153,164,166,166,174,164,173,157,173,155,168,145,161,145,166,140,170,132,154,123,143,125,136,136,132,121,120,119,112,106,125,82,135,66,134,59,128,59,125,65,125,66,127,69,123,75,122,88,124,91,112,98,103,128,95,147,86,182,91,200,90,215,84,215,80,220,81,222,77,219,73,229,76,236,74,240,71,240,62,262,55],[211,158,207,162,207,164,210,164,214,163]],

  [[263,50,265,53,267,52,266,60,273,64,292,83,292,86,290,91,285,94,262,84,256,87,251,104,238,126,237,134,227,142,234,155,231,164,215,170,208,169,189,180,182,180,180,174,170,176,158,166,156,166,155,170,152,166,148,166,147,162,129,145,132,140,140,136,135,132,122,120,120,114,116,113,116,116,106,126,85,136,68,139,63,134,63,132,72,133,74,129,77,129,70,128,71,126,87,126,87,115,95,105,114,98,129,96,133,92,148,86,198,90,205,85,212,85,220,81,221,78,231,75,238,68,237,64,243,63,242,59,244,57,257,55,257,53,261,54],[167,130,156,139,155,157,174,167,178,173,195,171,201,167,198,162,204,159,207,143],[218,152,213,160,219,161,224,160,225,156]],

  [[263,50,266,53,265,60,273,65,292,86,289,93,284,95,272,88,262,85,257,86,252,102,239,124,238,133,233,138,243,148,243,156,229,168,219,167,213,172,180,170,187,179,179,181,174,175,165,172,152,163,149,158,137,151,137,146,144,140,142,136,137,134,124,123,119,114,116,114,104,128,78,141,68,142,74,135,79,134,78,131,73,129,86,127,84,119,87,121,85,117,95,106,110,100,128,98,144,88,182,91,199,90,204,85,213,85,221,80,234,64,244,62,244,57,247,54,253,56,261,54],[169,131,160,139,163,160,175,169,178,169,184,162,187,162,188,165,194,165,210,165,208,144,186,139],[223,147,219,159,230,159,234,156,235,151]],

  [[264,51,265,54,269,52,267,61,287,81,291,86,291,90,288,95,280,97,278,93,269,88,259,86,256,89,239,127,240,133,253,137,255,142,248,162,235,173,233,173,234,164,231,166,210,166,207,163,198,161,197,158,201,155,208,155,208,157,217,160,226,160,214,145,191,143,168,136,162,154,164,157,182,164,183,169,178,168,177,170,167,166,178,178,187,188,179,190,155,166,154,161,149,158,150,150,148,147,136,138,124,126,120,118,116,116,111,117,92,138,72,147,72,143,77,141,76,136,79,136,81,132,81,121,92,108,109,102,128,100,143,90,196,92,202,89,203,86,212,86,220,77,220,68,216,67,217,65,222,65,229,60,242,60,245,55,263,55],[240,142,229,144,236,161,238,161,239,156,244,154,247,147,245,142]],

  [[267,51,268,54,271,53,270,62,278,68,293,90,290,96,282,98,279,93,260,85,247,108,242,129,254,131,260,137,259,159,254,174,248,169,248,163,250,162,248,154,253,150,253,141,251,139,239,141,239,144,246,150,245,158,226,165,216,160,211,154,220,152,223,156,234,156,237,155,236,152,220,144,184,143,174,140,170,142,170,157,190,165,193,170,188,170,185,173,179,168,161,162,158,161,161,174,173,190,178,193,177,195,169,196,167,194,164,187,149,170,143,148,132,138,118,118,110,118,98,126,92,133,91,139,73,149,74,145,78,144,73,140,78,135,77,126,80,125,81,119,92,108,109,102,128,101,144,91,194,93,202,87,213,84,219,74,217,69,220,69,217,63,222,66,228,64,224,58,244,60,246,55,252,53,265,55],[156,141,157,157,158,145]]
];

// 保留原项目的头颈俯仰微调。
(function fineTuneHeadNeck() {
  const inHead = (x, y) => x > 232 && y < 120;

  const NUDGE = {
    0: [-2, -4],
    1: [-2, -5],
    7: [-1, -4],
    8: [-1, -3],
    3: [4, 6],
    4: [5, 7],
    12: [4, 6],
    13: [5, 7]
  };

  HORSE_POSES.forEach((pose, f) => {
    const nudge = NUDGE[f];

    if (!nudge) return;

    for (const poly of pose) {
      for (let k = 0; k < poly.length; k += 2) {
        if (inHead(poly[k], poly[k + 1])) {
          poly[k] += nudge[0];
          poly[k + 1] += nudge[1];
        }
      }
    }
  });
})();

// 独立展示页启动，无需加载 p5.js。
setup();
