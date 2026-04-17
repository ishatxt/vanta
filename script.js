'use strict';

// ─────────────────────────────────────────────
//  GLSL SHADER CONSTANTS
// ─────────────────────────────────────────────

const VERT_SRC = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// ── Pass-through (copy) shader ──
const FRAG_COPY = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, v_uv);
}`;

// ── Grain ──
const FRAG_GRAIN = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_intensity;
uniform float u_size;
uniform float u_time;
in vec2 v_uv;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(234.56, 789.01));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = v_uv;
  vec4 color = texture(u_tex, uv);
  vec2 cell = floor(uv * (1.0 / max(u_size, 0.001)));
  float g = hash(cell + u_time) * 2.0 - 1.0;
  color.rgb += g * u_intensity;
  fragColor = clamp(color, 0.0, 1.0);
}`;

// ── Chromatic Aberration ──
const FRAG_CHROMA = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_strength;
uniform float u_falloff;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 uv = v_uv;
  vec2 center = uv - 0.5;
  float dist = length(center);
  float factor = pow(dist, max(u_falloff, 0.5)) * u_strength;
  vec2 dir = normalize(center + 0.00001) * factor;

  float r = texture(u_tex, uv + dir).r;
  float g = texture(u_tex, uv).g;
  float b = texture(u_tex, uv - dir).b;
  float a = texture(u_tex, uv).a;

  fragColor = vec4(r, g, b, a);
}`;

// ── Halftone ──
const FRAG_HALFTONE = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_dotSize;
uniform float u_contrast;
uniform float u_bw;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 uv = v_uv;
  vec4 src = texture(u_tex, uv);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  lum = clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  float s = max(u_dotSize, 0.002);
  vec2 cell = floor(uv / s) * s + s * 0.5;
  float d = length(uv - cell);
  float radius = sqrt(1.0 - lum) * s * 0.5;
  float dot_ = step(d, radius);

  vec3 inkColor = (u_bw > 0.5) ? vec3(0.0) : src.rgb * 0.4;
  vec3 col = mix(vec3(1.0), inkColor, dot_);

  fragColor = vec4(col, src.a);
}`;

// ── Pixelate ──
const FRAG_PIXELATE = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_gridSize;
in vec2 v_uv;
out vec4 fragColor;

void main() {
  float s = max(u_gridSize, 0.002);
  vec2 snapped = floor(v_uv / s) * s + s * 0.5;
  fragColor = texture(u_tex, snapped);
}`;

// ── Dither (Bayer 4x4) ──
const FRAG_DITHER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_levels;
uniform float u_strength;
in vec2 v_uv;
out vec4 fragColor;

float bayer4[16];

float bayerValue(ivec2 p) {
  // 4×4 Bayer matrix normalised to 0-1
  float m[16];
  m[0]  =  0.0/16.0; m[1]  =  8.0/16.0; m[2]  =  2.0/16.0; m[3]  = 10.0/16.0;
  m[4]  = 12.0/16.0; m[5]  =  4.0/16.0; m[6]  = 14.0/16.0; m[7]  =  6.0/16.0;
  m[8]  =  3.0/16.0; m[9]  = 11.0/16.0; m[10] =  1.0/16.0; m[11] =  9.0/16.0;
  m[12] = 15.0/16.0; m[13] =  7.0/16.0; m[14] = 13.0/16.0; m[15] =  5.0/16.0;
  int idx = (p.y % 4) * 4 + (p.x % 4);
  return m[idx];
}

void main() {
  vec2 texSize = vec2(textureSize(u_tex, 0));
  vec4 src = texture(u_tex, v_uv);
  ivec2 px = ivec2(v_uv * texSize);

  float threshold = bayerValue(px);
  float levels = max(u_levels, 2.0);

  vec3 col = src.rgb;
  col += (threshold - 0.5) * u_strength;
  col = floor(col * (levels - 1.0) + 0.5) / (levels - 1.0);

  fragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}`;

// ── Bloom (two-pass Gaussian approximated via dual downscale) ──
// Horizontal pass
const FRAG_BLOOM_H = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_radius;
uniform float u_threshold;
in vec2 v_uv;
out vec4 fragColor;

vec4 blur13H(sampler2D tex, vec2 uv, vec2 texel, float r) {
  vec4 sum = vec4(0.0);
  float weights[7];
  weights[0]=0.0044; weights[1]=0.0540; weights[2]=0.2420;
  weights[3]=0.3990; weights[4]=0.2420; weights[5]=0.0540; weights[6]=0.0044;
  for(int i=0;i<7;i++){
    float off = float(i-3) * r;
    sum += texture(tex, uv + vec2(off * texel.x, 0.0)) * weights[i];
  }
  return sum;
}

void main() {
  vec2 texel = 1.0 / vec2(textureSize(u_tex, 0));
  vec4 bright = texture(u_tex, v_uv);
  float lum = dot(bright.rgb, vec3(0.299,0.587,0.114));
  bright.rgb *= step(u_threshold, lum);
  vec4 blurred = blur13H(u_tex, v_uv, texel, u_radius);
  blurred.rgb *= step(u_threshold, dot(blurred.rgb, vec3(0.299,0.587,0.114)));
  fragColor = blurred;
}`;

// Vertical + composite pass
const FRAG_BLOOM_V = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_bloom;
uniform float u_radius;
uniform float u_intensity;
uniform float u_threshold;
in vec2 v_uv;
out vec4 fragColor;

vec4 blur13V(sampler2D tex, vec2 uv, vec2 texel, float r) {
  vec4 sum = vec4(0.0);
  float weights[7];
  weights[0]=0.0044; weights[1]=0.0540; weights[2]=0.2420;
  weights[3]=0.3990; weights[4]=0.2420; weights[5]=0.0540; weights[6]=0.0044;
  for(int i=0;i<7;i++){
    float off = float(i-3) * r;
    sum += texture(tex, uv + vec2(0.0, off * texel.y)) * weights[i];
  }
  return sum;
}

void main() {
  vec2 texel = 1.0 / vec2(textureSize(u_bloom, 0));
  vec4 src = texture(u_tex, v_uv);
  vec4 blurred = blur13V(u_bloom, v_uv, texel, u_radius);
  blurred.rgb *= step(u_threshold, dot(blurred.rgb, vec3(0.299,0.587,0.114)));
  fragColor = src + blurred * u_intensity;
}`;

// ─────────────────────────────────────────────
//  PARAM DEFINITIONS
// ─────────────────────────────────────────────

const PARAMS = {
  texture: [
    { id: 'grain_intensity', label: 'Grain Intensity', min: 0, max: 1,   step: 0.01, def: 0.15, category: 'texture' },
    { id: 'grain_size',      label: 'Grain Size',      min: 0.001, max: 0.04, step: 0.001, def: 0.004, category: 'texture' },
    { id: 'dither_levels',   label: 'Dither Levels',   min: 2, max: 16,  step: 1,    def: 4,    category: 'texture' },
    { id: 'dither_strength', label: 'Dither Mix',      min: 0, max: 1,   step: 0.01, def: 0.5,  category: 'texture' },
    { id: 'halftone_size',   label: 'Halftone Scale',  min: 0.002, max: 0.04, step: 0.001, def: 0.01, category: 'texture' },
    { id: 'halftone_contrast',label:'Halftone Contrast',min:0.5,max:4,   step: 0.05, def: 1.5,  category: 'texture' },
  ],
  color: [
    { id: 'brightness',  label: 'Brightness', min: -1,  max: 1,   step: 0.01, def: 0,   category: 'color' },
    { id: 'contrast',    label: 'Contrast',   min: 0.1, max: 3,   step: 0.05, def: 1,   category: 'color' },
    { id: 'saturation',  label: 'Saturation', min: 0,   max: 2,   step: 0.05, def: 1,   category: 'color' },
    { id: 'hue_shift',   label: 'Hue Shift',  min: -180,max: 180, step: 1,    def: 0,   category: 'color' },
  ],
  distort: [
    { id: 'chroma_strength', label: 'CA Strength', min: 0, max: 0.06, step: 0.001, def: 0.01, category: 'distort' },
    { id: 'chroma_falloff',  label: 'CA Falloff',  min: 0.5, max: 4,  step: 0.1,   def: 1.5,  category: 'distort' },
    { id: 'pixelate_size',   label: 'Pixelate',    min: 0.002, max: 0.05, step: 0.001, def: 0.002, category: 'distort' },
    { id: 'vignette',        label: 'Vignette',    min: 0, max: 2,    step: 0.05,  def: 0.5,  category: 'distort' },
  ],
  light: [
    { id: 'bloom_intensity', label: 'Bloom Intensity', min: 0, max: 3,    step: 0.05, def: 0.5, category: 'light' },
    { id: 'bloom_radius',    label: 'Bloom Radius',    min: 1, max: 6,    step: 0.5,  def: 2.5, category: 'light' },
    { id: 'bloom_threshold', label: 'Bloom Threshold', min: 0, max: 1,    step: 0.01, def: 0.6, category: 'light' },
    { id: 'exposure',        label: 'Exposure',        min: -2, max: 2,   step: 0.05, def: 0,   category: 'light' },
  ],
};

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────

const state = {
  image: null,
  values: {},
  activeCategory: 'texture',
  inspectorOpen: true,
  time: 0,
};

// Flatten and initialise defaults
Object.values(PARAMS).flat().forEach(p => { state.values[p.id] = p.def; });

// ─────────────────────────────────────────────
//  DOM REFS
// ─────────────────────────────────────────────

const canvas       = document.getElementById('gl-canvas');
const dropOverlay  = document.getElementById('drop-overlay');
const fileInput    = document.getElementById('file-input');
const btnOpen      = document.getElementById('btn-open');
const btnSave      = document.getElementById('btn-save');
const btnReset     = document.getElementById('btn-reset');
const inspectorEl  = document.getElementById('inspector');
const inspectorBody= document.getElementById('inspector-body');
const navBtns      = document.querySelectorAll('.nav-btn[data-category]');
const inspToggleBtn= document.getElementById('inspector-toggle-btn');
const inspClose    = document.getElementById('inspector-toggle');

// ─────────────────────────────────────────────
//  WEBGL SETUP
// ─────────────────────────────────────────────

const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
if (!gl) alert('WebGL 2 not supported in your browser.');

// Compile helper
function compileShader(src, type) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    console.error(gl.getShaderInfoLog(sh));
  return sh;
}

function createProgram(fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(VERT_SRC, gl.VERTEX_SHADER));
  gl.attachShader(prog, compileShader(fragSrc,  gl.FRAGMENT_SHADER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    console.error(gl.getProgramInfoLog(prog));
  return prog;
}

// Programs
const programs = {
  copy:     createProgram(FRAG_COPY),
  grain:    createProgram(FRAG_GRAIN),
  chroma:   createProgram(FRAG_CHROMA),
  halftone: createProgram(FRAG_HALFTONE),
  pixelate: createProgram(FRAG_PIXELATE),
  dither:   createProgram(FRAG_DITHER),
  bloomH:   createProgram(FRAG_BLOOM_H),
  bloomV:   createProgram(FRAG_BLOOM_V),
};

// Full-screen quad
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1,-1,  1,-1,  -1,1,
   1,-1,  1, 1,  -1,1,
]), gl.STATIC_DRAW);

function bindQuad(prog) {
  const loc = gl.getAttribLocation(prog, 'a_position');
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

// ── Texture helpers ──
let imageTexture = null;

function createTexture(width, height, data = null) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (data) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  return tex;
}

function uploadImage(img) {
  if (imageTexture) gl.deleteTexture(imageTexture);
  imageTexture = createTexture(0, 0, img);
}

// ── Framebuffer ping-pong ──
let fbos = [];

function initFBOs(w, h) {
  fbos.forEach(f => { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });
  fbos = [0, 1].map(() => {
    const tex = createTexture(w, h);
    const fb  = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─────────────────────────────────────────────
//  RENDER PIPELINE
// ─────────────────────────────────────────────

let W = 1, H = 1, ping = 0;

function drawPass(prog, srcTex, dstFB, uniforms = {}) {
  gl.useProgram(prog);
  bindQuad(prog);

  // Bind source texture
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  const uTex = gl.getUniformLocation(prog, 'u_tex');
  if (uTex) gl.uniform1i(uTex, 0);

  // Set additional uniforms
  for (const [name, val] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(prog, name);
    if (!loc) continue;
    if (typeof val === 'number') gl.uniform1f(loc, val);
    else if (val instanceof WebGLTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, val);
      gl.uniform1i(loc, 1);
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFB);
  gl.viewport(0, 0, W, H);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function swapPing() { ping = 1 - ping; }
function src() { return fbos[ping].tex; }
function dst() { return fbos[1 - ping].fb; }
function swap() { swapPing(); }

// HSL adjust (CPU uniform version baked into a combined shader)
const FRAG_ADJUST = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hue;
uniform float u_exposure;
uniform float u_vignette;
in vec2 v_uv;
out vec4 fragColor;

vec3 rgb2hsl(vec3 c){
  float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));
  float h=0.,s=0.,l=(mx+mn)/2.;
  if(mx!=mn){float d=mx-mn;s=l>.5?d/(2.-mx-mn):d/(mx+mn);
    if(mx==c.r)h=(c.g-c.b)/d+(c.g<c.b?6.:0.);
    else if(mx==c.g)h=(c.b-c.r)/d+2.;
    else h=(c.r-c.g)/d+4.;h/=6.;}
  return vec3(h,s,l);
}
float hue2rgb(float p,float q,float t){
  if(t<0.)t+=1.;if(t>1.)t-=1.;
  if(t<1./6.)return p+(q-p)*6.*t;
  if(t<1./2.)return q;
  if(t<2./3.)return p+(q-p)*(2./3.-t)*6.;
  return p;
}
vec3 hsl2rgb(vec3 c){
  if(c.y==0.)return vec3(c.z);
  float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y;
  float p=2.*c.z-q;
  return vec3(hue2rgb(p,q,c.x+1./3.),hue2rgb(p,q,c.x),hue2rgb(p,q,c.x-1./3.));
}

void main(){
  vec2 uv=v_uv;
  vec4 col=texture(u_tex,uv);
  // Exposure
  col.rgb *= pow(2.0, u_exposure);
  // Brightness
  col.rgb += u_brightness;
  // Contrast
  col.rgb = (col.rgb - 0.5) * u_contrast + 0.5;
  // Saturation & Hue
  vec3 hsl = rgb2hsl(clamp(col.rgb,0.,1.));
  hsl.x = fract(hsl.x + u_hue / 360.0);
  hsl.y *= u_saturation;
  col.rgb = hsl2rgb(hsl);
  // Vignette
  vec2 vd = uv - 0.5;
  float vig = 1.0 - dot(vd,vd) * u_vignette * 4.0;
  col.rgb *= clamp(vig, 0.0, 1.0);
  fragColor = clamp(col, 0.0, 1.0);
}`;

const programs2 = { adjust: createProgram(FRAG_ADJUST) };

function renderAll(w, h) {
  if (!imageTexture) return;
  W = w; H = h;
  initFBOs(w, h);

  // Step 0: Upload image to fbo[0]
  drawPass(programs.copy, imageTexture, fbos[0].fb);
  ping = 0;

  const v = state.values;

  // Step 1: Color/Exposure Adjust
  drawPass(programs2.adjust, src(), fbos[1].fb, {
    u_brightness: v.brightness,
    u_contrast:   v.contrast,
    u_saturation: v.saturation,
    u_hue:        v.hue_shift,
    u_exposure:   v.exposure,
    u_vignette:   v.vignette,
  });
  swap();

  // Step 2: Chromatic Aberration
  drawPass(programs.chroma, src(), dst(), {
    u_strength: v.chroma_strength,
    u_falloff:  v.chroma_falloff,
  });
  swap();

  // Step 3: Pixelate (skip if tiny)
  if (v.pixelate_size > 0.003) {
    drawPass(programs.pixelate, src(), dst(), {
      u_gridSize: v.pixelate_size,
    });
    swap();
  }

  // Step 4: Halftone (only if size is meaningful)
  if (v.halftone_size > 0.003) {
    drawPass(programs.halftone, src(), dst(), {
      u_dotSize:  v.halftone_size,
      u_contrast: v.halftone_contrast,
      u_bw:       0.0,
    });
    swap();
  }

  // Step 5: Dither
  drawPass(programs.dither, src(), dst(), {
    u_levels:   v.dither_levels,
    u_strength: v.dither_strength,
  });
  swap();

  // Step 6: Bloom (horizontal blur)
  const bloomIntermediate = createTexture(w, h);
  const bloomFB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomIntermediate, 0);

  drawPass(programs.bloomH, src(), bloomFB, {
    u_radius:    v.bloom_radius,
    u_threshold: v.bloom_threshold,
  });

  // Step 6b: Bloom vertical + composite
  drawPass(programs.bloomV, src(), dst(), {
    u_bloom:     bloomIntermediate,
    u_radius:    v.bloom_radius,
    u_intensity: v.bloom_intensity,
    u_threshold: v.bloom_threshold,
  });
  swap();
  gl.deleteTexture(bloomIntermediate);
  gl.deleteFramebuffer(bloomFB);

  // Step 7: Grain
  drawPass(programs.grain, src(), dst(), {
    u_intensity: v.grain_intensity,
    u_size:      v.grain_size,
    u_time:      state.time * 0.01,
  });
  swap();

  // Final: blit to canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  drawPass(programs.copy, src(), null);
}

// ─────────────────────────────────────────────
//  RAF LOOP
// ─────────────────────────────────────────────

let rafId = null;
let needsRender = true;

function scheduleRender() { needsRender = true; }

function loop() {
  state.time++;
  if (needsRender && state.image) {
    renderAll(canvas.width, canvas.height);
    needsRender = false;
  }
  // Always re-render if grain intensity > 0 (animated)
  if (state.values.grain_intensity > 0 && state.image) {
    renderAll(canvas.width, canvas.height);
  }
  rafId = requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// ─────────────────────────────────────────────
//  IMAGE LOADING
// ─────────────────────────────────────────────

let nativeW = 1, nativeH = 1;

function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    nativeW = img.naturalWidth;
    nativeH = img.naturalHeight;
    state.image = img;

    uploadImage(img);
    fitCanvas(img.naturalWidth, img.naturalHeight);
    dropOverlay.classList.add('hidden');
    btnSave.disabled = false;
    URL.revokeObjectURL(url);
    scheduleRender();
  };
  img.src = url;
}

function fitCanvas(iw, ih) {
  const area = document.getElementById('canvas-area');
  const maxW = area.clientWidth  - 40;
  const maxH = area.clientHeight - 40;
  const ratio = Math.min(maxW / iw, maxH / ih, 1);
  canvas.width  = Math.round(iw * ratio);
  canvas.height = Math.round(ih * ratio);
}

// ─────────────────────────────────────────────
//  INSPECTOR UI BUILDER
// ─────────────────────────────────────────────

function buildInspector() {
  inspectorBody.innerHTML = '';
  Object.values(PARAMS).flat().forEach(p => {
    const group = document.createElement('div');
    group.className = `param-group ${p.category !== state.activeCategory ? 'hidden' : ''}`;
    group.dataset.category = p.category;

    const lbl = document.createElement('div');
    lbl.className = 'param-label';
    lbl.innerHTML = `
      <span class="param-name">${p.label}</span>
      <span class="param-value" id="val-${p.id}">${fmt(p.id)}</span>
    `;

    const wrap = document.createElement('div');
    wrap.className = 'slider-track-wrap';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'param-slider';
    slider.min   = p.min;
    slider.max   = p.max;
    slider.step  = p.step;
    slider.value = state.values[p.id];
    slider.id    = `slider-${p.id}`;

    const fill = document.createElement('div');
    fill.className = 'slider-track-fill';
    fill.id = `fill-${p.id}`;
    updateFill(fill, slider, p);

    slider.addEventListener('input', () => {
      state.values[p.id] = parseFloat(slider.value);
      document.getElementById(`val-${p.id}`).textContent = fmt(p.id);
      updateFill(fill, slider, p);
      scheduleRender();
    });

    wrap.appendChild(slider);
    wrap.appendChild(fill);
    group.appendChild(lbl);
    group.appendChild(wrap);
    inspectorBody.appendChild(group);
  });
}

function fmt(id) {
  const v = state.values[id];
  return Number.isInteger(v) ? v : v.toFixed(3);
}

function updateFill(fill, slider, p) {
  const pct = (parseFloat(slider.value) - p.min) / (p.max - p.min) * 100;
  fill.style.width = pct + '%';
}

function showCategory(cat) {
  state.activeCategory = cat;
  document.querySelectorAll('.param-group').forEach(g => {
    g.classList.toggle('hidden', g.dataset.category !== cat);
  });
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.category === cat));
}

// ─────────────────────────────────────────────
//  EXPORT
// ─────────────────────────────────────────────

function exportImage() {
  if (!state.image) return;

  // Render at native resolution
  const prevW = canvas.width, prevH = canvas.height;
  canvas.width  = nativeW;
  canvas.height = nativeH;
  renderAll(nativeW, nativeH);

  const link = document.createElement('a');
  link.download = 'grain-lab-export.png';
  link.href = canvas.toDataURL('image/png');
  link.click();

  // Restore display size
  canvas.width  = prevW;
  canvas.height = prevH;
  scheduleRender();
}

// ─────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────

btnOpen.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => loadImage(e.target.files[0]));
btnSave.addEventListener('click', exportImage);

// Drag-and-drop
const dropArea = document.getElementById('canvas-area');
dropArea.addEventListener('dragover', e => {
  e.preventDefault();
  dropOverlay.classList.add('drag-active');
});
dropArea.addEventListener('dragleave', () => {
  dropOverlay.classList.remove('drag-active');
});
dropArea.addEventListener('drop', e => {
  e.preventDefault();
  dropOverlay.classList.remove('drag-active');
  loadImage(e.dataTransfer.files[0]);
});

// Bottom nav
navBtns.forEach(btn => {
  btn.addEventListener('click', () => showCategory(btn.dataset.category));
});

// Inspector toggle
function toggleInspector() {
  state.inspectorOpen = !state.inspectorOpen;
  inspectorEl.classList.toggle('collapsed', !state.inspectorOpen);
  inspToggleBtn.textContent = state.inspectorOpen ? '⟩ PANEL' : '⟨ PANEL';
}
inspToggleBtn.addEventListener('click', toggleInspector);
inspClose.addEventListener('click', toggleInspector);

// Reset
btnReset.addEventListener('click', () => {
  Object.values(PARAMS).flat().forEach(p => {
    state.values[p.id] = p.def;
    const sl = document.getElementById(`slider-${p.id}`);
    const fl = document.getElementById(`fill-${p.id}`);
    if (sl) sl.value = p.def;
    if (fl) updateFill(fl, sl, p);
    const vl = document.getElementById(`val-${p.id}`);
    if (vl) vl.textContent = fmt(p.id);
  });
  scheduleRender();
});

// Window resize
window.addEventListener('resize', () => {
  if (state.image) {
    fitCanvas(nativeW, nativeH);
    scheduleRender();
  }
});

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────

buildInspector();
showCategory('texture');