import { GRAIN_PRESETS, clamp, deepClone } from "../state.js";
import { createCanvas } from "../image-pipeline.js";

export { GRAIN_PRESETS };

const VERT_SRC = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAG_COPY = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  fragColor = texture(u_tex, v_uv);
}`;

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

const FRAG_DITHER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_levels;
uniform float u_strength;
in vec2 v_uv;
out vec4 fragColor;

float bayerValue(ivec2 p) {
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
  col.rgb *= pow(2.0, u_exposure);
  col.rgb += u_brightness;
  col.rgb = (col.rgb - 0.5) * u_contrast + 0.5;
  vec3 hsl = rgb2hsl(clamp(col.rgb,0.,1.));
  hsl.x = fract(hsl.x + u_hue / 360.0);
  hsl.y *= u_saturation;
  col.rgb = hsl2rgb(hsl);
  vec2 vd = uv - 0.5;
  float vig = 1.0 - dot(vd,vd) * u_vignette * 4.0;
  col.rgb *= clamp(vig, 0.0, 1.0);
  fragColor = clamp(col, 0.0, 1.0);
}`;

const FRAG_FILM = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_temperature;
uniform float u_tint;
uniform float u_fade;
uniform float u_halation;
uniform float u_lightLeak;
uniform float u_dust;
uniform float u_time;
in vec2 v_uv;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.56, 789.01));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec3 col = src.rgb;

  col.r += u_temperature * 0.10;
  col.b -= u_temperature * 0.10;
  col.g += u_tint * 0.08;
  col.r -= u_tint * 0.02;
  col.b -= u_tint * 0.02;

  col = col * (1.0 - u_fade * 0.35) + vec3(1.0, 0.92, 0.82) * u_fade * 0.11;

  vec3 halo = vec3(0.0);
  halo += texture(u_tex, v_uv + vec2( 2.0,  0.0) * u_texel).rgb;
  halo += texture(u_tex, v_uv + vec2(-2.0,  0.0) * u_texel).rgb;
  halo += texture(u_tex, v_uv + vec2( 0.0,  2.0) * u_texel).rgb;
  halo += texture(u_tex, v_uv + vec2( 0.0, -2.0) * u_texel).rgb;
  halo += texture(u_tex, v_uv + vec2( 5.0,  3.0) * u_texel).rgb;
  halo += texture(u_tex, v_uv + vec2(-5.0, -3.0) * u_texel).rgb;
  halo /= 6.0;
  float haloLum = dot(halo, vec3(0.299, 0.587, 0.114));
  halo *= smoothstep(0.58, 1.0, haloLum);
  col += halo * vec3(1.0, 0.32, 0.1) * u_halation * 1.15;

  float leak = smoothstep(0.0, 1.0, v_uv.x * 0.72 + v_uv.y * 0.28);
  float streak = 0.55 + 0.45 * sin((v_uv.y * 1.4 + u_time * 0.012) * 6.2831);
  col += vec3(1.0, 0.33, 0.1) * u_lightLeak * 0.18 * leak * streak;

  vec2 dustCell = floor(v_uv * vec2(220.0, 320.0));
  float dustHash = hash21(dustCell + u_time * 0.003);
  float dustMask = step(0.9982, dustHash);
  col += vec3(dustMask * u_dust * 0.7);

  float scratchHash = hash21(vec2(floor(v_uv.x * 190.0), 17.0));
  float scratch = step(0.9986, scratchHash) * u_dust;
  col += vec3(scratch * 0.12);

  fragColor = vec4(clamp(col, 0.0, 1.0), src.a);
}`;

function compileShader(gl, source, type) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL could not create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl, fragmentSource) {
  const vertex = compileShader(gl, VERT_SRC, gl.VERTEX_SHADER);
  const fragment = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "Unknown program link error.";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return { program, uniforms: new Map() };
}

export function isWebGL2Available() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

export function applyGrainPreset(settings, presetId) {
  const preset = GRAIN_PRESETS.find((item) => item.id === presetId);
  if (!preset) return deepClone(settings);
  return {
    ...deepClone(settings),
    ...deepClone(preset.settings),
  };
}

export class GrainLabEngine {
  constructor(canvas, { onContextLost = null } = {}) {
    this.canvas = canvas;
    this.onContextLost = onContextLost;
    this.gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!this.gl) throw new Error("WebGL 2 is not available in this browser.");
    this.lost = false;
    this.sourceTexture = null;
    this.sourceCanvas = null;
    this.sourceKey = "";
    this.width = 0;
    this.height = 0;
    this.fbos = [];
    this.bloomTexture = null;
    this.bloomFramebuffer = null;
    this.ping = 0;
    this.handleContextLost = (event) => {
      event.preventDefault();
      this.lost = true;
      this.onContextLost?.();
    };
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.init();
  }

  init() {
    const gl = this.gl;
    this.programs = {
      copy: createProgram(gl, FRAG_COPY),
      grain: createProgram(gl, FRAG_GRAIN),
      chroma: createProgram(gl, FRAG_CHROMA),
      halftone: createProgram(gl, FRAG_HALFTONE),
      pixelate: createProgram(gl, FRAG_PIXELATE),
      dither: createProgram(gl, FRAG_DITHER),
      bloomH: createProgram(gl, FRAG_BLOOM_H),
      bloomV: createProgram(gl, FRAG_BLOOM_V),
      adjust: createProgram(gl, FRAG_ADJUST),
      film: createProgram(gl, FRAG_FILM),
    };
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      1, -1, 1, 1, -1, 1,
    ]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  uniformLocation(program, name) {
    if (!program.uniforms.has(name)) {
      program.uniforms.set(name, this.gl.getUniformLocation(program.program, name));
    }
    return program.uniforms.get(name);
  }

  bindQuad(program) {
    const gl = this.gl;
    const location = gl.getAttribLocation(program.program, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }

  createTexture(width, height, data = null) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (data) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    return texture;
  }

  uploadSource(canvas, key) {
    if (this.sourceCanvas === canvas && this.sourceKey === key && this.sourceTexture) return;
    const gl = this.gl;
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    this.sourceTexture = this.createTexture(0, 0, canvas);
    this.sourceCanvas = canvas;
    this.sourceKey = key;
  }

  ensureSize(width, height) {
    if (this.width === width && this.height === height && this.fbos.length === 2) return;
    const gl = this.gl;
    for (const fbo of this.fbos) {
      gl.deleteFramebuffer(fbo.framebuffer);
      gl.deleteTexture(fbo.texture);
    }
    this.fbos = [];
    if (this.bloomTexture) gl.deleteTexture(this.bloomTexture);
    if (this.bloomFramebuffer) gl.deleteFramebuffer(this.bloomFramebuffer);
    this.bloomTexture = null;
    this.bloomFramebuffer = null;

    this.width = width;
    this.height = height;
    this.fbos = [0, 1].map(() => {
      const texture = this.createTexture(width, height);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return { texture, framebuffer };
    });
    this.bloomTexture = this.createTexture(width, height);
    this.bloomFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bloomTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
  }

  drawPass(program, sourceTexture, destinationFramebuffer, uniforms = {}) {
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) return;
    gl.useProgram(program.program);
    this.bindQuad(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    const textureLocation = this.uniformLocation(program, "u_tex");
    if (textureLocation) gl.uniform1i(textureLocation, 0);

    for (const [name, value] of Object.entries(uniforms)) {
      const location = this.uniformLocation(program, name);
      if (!location) continue;
      if (value instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.uniform1i(location, 1);
      } else if (Array.isArray(value)) {
        gl.uniform2f(location, value[0], value[1]);
      } else {
        gl.uniform1f(location, Number(value));
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, destinationFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  source() {
    return this.fbos[this.ping].texture;
  }

  destination() {
    return this.fbos[1 - this.ping].framebuffer;
  }

  swap() {
    this.ping = 1 - this.ping;
  }

  render(sourceCanvas, settings, {
    width = sourceCanvas.width,
    height = sourceCanvas.height,
    sourceKey = "",
    time = 0,
  } = {}) {
    if (this.lost || !this.gl || this.gl.isContextLost()) return false;
    const outWidth = Math.max(1, Math.round(width));
    const outHeight = Math.max(1, Math.round(height));
    if (this.canvas.width !== outWidth || this.canvas.height !== outHeight) {
      this.canvas.width = outWidth;
      this.canvas.height = outHeight;
    }
    this.ensureSize(outWidth, outHeight);
    this.uploadSource(sourceCanvas, sourceKey);

    const v = settings;
    const gl = this.gl;
    this.drawPass(this.programs.copy, this.sourceTexture, this.fbos[0].framebuffer);
    this.ping = 0;

    this.drawPass(this.programs.adjust, this.source(), this.destination(), {
      u_brightness: v.brightness,
      u_contrast: v.contrast,
      u_saturation: v.saturation,
      u_hue: v.hueShift,
      u_exposure: v.exposure,
      u_vignette: v.vignette,
    });
    this.swap();

    this.drawPass(this.programs.chroma, this.source(), this.destination(), {
      u_strength: v.chromaStrength,
      u_falloff: v.chromaFalloff,
    });
    this.swap();

    if (v.pixelateSize > 0.003) {
      this.drawPass(this.programs.pixelate, this.source(), this.destination(), {
        u_gridSize: v.pixelateSize,
      });
      this.swap();
    }

    if (v.halftoneSize > 0.003) {
      this.drawPass(this.programs.halftone, this.source(), this.destination(), {
        u_dotSize: v.halftoneSize,
        u_contrast: v.halftoneContrast,
        u_bw: 0,
      });
      this.swap();
    }

    this.drawPass(this.programs.dither, this.source(), this.destination(), {
      u_levels: v.ditherLevels,
      u_strength: v.ditherStrength,
    });
    this.swap();

    this.drawPass(this.programs.bloomH, this.source(), this.bloomFramebuffer, {
      u_radius: v.bloomRadius,
      u_threshold: v.bloomThreshold,
    });
    this.drawPass(this.programs.bloomV, this.source(), this.destination(), {
      u_bloom: this.bloomTexture,
      u_radius: v.bloomRadius,
      u_intensity: v.bloomIntensity,
      u_threshold: v.bloomThreshold,
    });
    this.swap();

    this.drawPass(this.programs.film, this.source(), this.destination(), {
      u_texel: [1 / outWidth, 1 / outHeight],
      u_temperature: v.temperature,
      u_tint: v.tint,
      u_fade: v.fade,
      u_halation: v.halation,
      u_lightLeak: v.lightLeak,
      u_dust: v.dust,
      u_time: time,
    });
    this.swap();

    this.drawPass(this.programs.grain, this.source(), this.destination(), {
      u_intensity: v.grainIntensity,
      u_size: v.grainSize,
      u_time: time * 0.6,
    });
    this.swap();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outWidth, outHeight);
    this.drawPass(this.programs.copy, this.source(), null);
    return true;
  }

  dispose() {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    if (!gl) return;
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
    if (this.bloomTexture) gl.deleteTexture(this.bloomTexture);
    if (this.bloomFramebuffer) gl.deleteFramebuffer(this.bloomFramebuffer);
    for (const fbo of this.fbos) {
      gl.deleteFramebuffer(fbo.framebuffer);
      gl.deleteTexture(fbo.texture);
    }
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
    for (const program of Object.values(this.programs || {})) {
      gl.deleteProgram(program.program);
    }
    this.fbos = [];
    this.programs = {};
    this.sourceTexture = null;
  }
}

export function renderGrainFallback(sourceCanvas, settings, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable.");

  const brightness = clamp(1 + settings.brightness, 0.1, 3);
  const contrast = clamp(settings.contrast, 0.1, 3);
  const saturation = clamp(settings.saturation, 0, 2);
  const hue = clamp(settings.hueShift, -180, 180);
  ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation}) hue-rotate(${hue}deg)`;
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  ctx.filter = "none";

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const invWidth = width > 1 ? 1 / (width - 1) : 0;
  const invHeight = height > 1 ? 1 / (height - 1) : 0;
  const vignette = clamp(settings.vignette, 0, 2);
  const fade = clamp(settings.fade, 0, 1);
  const grain = clamp(settings.grainIntensity, 0, 1);
  let seed = 0x51f15e ^ (width * 73856093) ^ (height * 19349663);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const dx = x * invWidth - 0.5;
      const dy = y * invHeight - 0.5;
      const vig = clamp(1 - (dx * dx + dy * dy) * vignette * 4, 0.05, 1);
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = (((seed >>> 0) / 4294967295) - 0.5) * grain * 96;
      for (let channel = 0; channel < 3; channel += 1) {
        let value = data[index + channel] * vig;
        value = value * (1 - fade * 0.35) + fade * 28;
        data[index + channel] = value + noise;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export const GRAIN_GROUPS = Object.freeze([
  {
    id: "film",
    label: "Film Stock",
    open: true,
    controls: [
      {
        type: "button-row",
        label: "Built-in stock",
        actions: GRAIN_PRESETS.map((preset) => ({
          id: `grain-preset-${preset.id}`,
          label: preset.label,
        })),
      },
      { type: "range", key: "grainIntensity", label: "Grain Intensity", min: 0, max: 1, step: 0.01, digits: 2, default: 0.15 },
      { type: "range", key: "grainSize", label: "Grain Size", min: 0.001, max: 0.04, step: 0.001, digits: 3, default: 0.004 },
      { type: "toggle", key: "animate", label: "Animate grain", default: true },
    ],
  },
  {
    id: "texture",
    label: "Texture",
    open: true,
    controls: [
      { type: "range", key: "ditherLevels", label: "Dither Levels", min: 2, max: 16, step: 1, digits: 0, default: 4 },
      { type: "range", key: "ditherStrength", label: "Dither Mix", min: 0, max: 1, step: 0.01, digits: 2, default: 0.5 },
      { type: "range", key: "halftoneSize", label: "Halftone Scale", min: 0.002, max: 0.04, step: 0.001, digits: 3, default: 0.01 },
      { type: "range", key: "halftoneContrast", label: "Halftone Contrast", min: 0.5, max: 4, step: 0.05, digits: 2, default: 1.5 },
    ],
  },
  {
    id: "color",
    label: "Color & Exposure",
    open: true,
    controls: [
      { type: "range", key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05, digits: 2, default: 0 },
      { type: "range", key: "brightness", label: "Brightness", min: -1, max: 1, step: 0.01, digits: 2, default: 0 },
      { type: "range", key: "contrast", label: "Contrast", min: 0.1, max: 3, step: 0.05, digits: 2, default: 1 },
      { type: "range", key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.05, digits: 2, default: 1 },
      { type: "range", key: "hueShift", label: "Hue Shift", min: -180, max: 180, step: 1, digits: 0, default: 0 },
      { type: "range", key: "temperature", label: "Film Temperature", min: -1, max: 1, step: 0.01, digits: 2, default: 0 },
      { type: "range", key: "tint", label: "Film Tint", min: -1, max: 1, step: 0.01, digits: 2, default: 0 },
      { type: "range", key: "fade", label: "Analog Fade", min: 0, max: 1, step: 0.01, digits: 2, default: 0 },
    ],
  },
  {
    id: "distort",
    label: "Distortion",
    open: false,
    controls: [
      { type: "range", key: "chromaStrength", label: "CA Strength", min: 0, max: 0.06, step: 0.001, digits: 3, default: 0.01 },
      { type: "range", key: "chromaFalloff", label: "CA Falloff", min: 0.5, max: 4, step: 0.1, digits: 1, default: 1.5 },
      { type: "range", key: "pixelateSize", label: "Pixelate", min: 0.002, max: 0.05, step: 0.001, digits: 3, default: 0.002 },
      { type: "range", key: "vignette", label: "Vignette", min: 0, max: 2, step: 0.05, digits: 2, default: 0.5 },
    ],
  },
  {
    id: "light",
    label: "Light & Finish",
    open: false,
    controls: [
      { type: "range", key: "bloomIntensity", label: "Bloom Intensity", min: 0, max: 3, step: 0.05, digits: 2, default: 0.5 },
      { type: "range", key: "bloomRadius", label: "Bloom Radius", min: 1, max: 6, step: 0.5, digits: 1, default: 2.5 },
      { type: "range", key: "bloomThreshold", label: "Bloom Threshold", min: 0, max: 1, step: 0.01, digits: 2, default: 0.6 },
      { type: "range", key: "halation", label: "Halation", min: 0, max: 1, step: 0.01, digits: 2, default: 0 },
      { type: "range", key: "lightLeak", label: "Light Leak", min: 0, max: 1, step: 0.01, digits: 2, default: 0 },
      { type: "range", key: "dust", label: "Dust & Scratches", min: 0, max: 1, step: 0.01, digits: 2, default: 0 },
    ],
  },
]);
