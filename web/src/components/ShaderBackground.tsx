import { useEffect, useRef } from 'react';

/**
 * Full-bleed WebGL background for the landing hero: slow-drifting fractal
 * nebula in SET's palette + twinkling starfield, vignette to black at edges.
 * MetalForge-style. Renders one static frame under prefers-reduced-motion
 * and falls back to a plain gradient when WebGL is unavailable.
 */
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0., a=.5;
  mat2 rot = mat2(.8,.6,-.6,.8);
  for(int i=0;i<5;i++){ v+=a*noise(p); p=rot*p*2.03; a*=.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 st = (gl_FragCoord.xy - .5*u_res.xy) / u_res.y;

  // slow nebula drift
  float t = u_time * .018;
  vec2 q = vec2(fbm(st + t), fbm(st + vec2(5.2,1.3) - t*.7));
  float f = fbm(st + 1.8*q + vec2(t*.4, -t*.2));

  // palette: deep navy base, blue/violet drifts
  vec3 base  = vec3(.016,.024,.055);
  vec3 blue  = vec3(.16,.28,.85);
  vec3 viol  = vec3(.42,.30,.85);
  vec3 col = base + blue * f*f * .42 + viol * pow(f,3.) * .35;
  col += blue * smoothstep(.55,.95,q.x) * .08;

  // starfield: two parallax layers of twinkling points
  for(float l=0.; l<2.; l++){
    float scale = 90. + l*140.;
    vec2 gp = st * scale + vec2(t*8.*(l+1.), 0.);
    vec2 id = floor(gp);
    vec2 gv = fract(gp)-.5;
    float h = hash(id + l*17.);
    if(h > .955){
      vec2 off = vec2(hash(id+1.7)-.5, hash(id+9.1)-.5)*.7;
      float d = length(gv-off);
      float tw = .55 + .45*sin(u_time*(1.5+h*4.)+h*40.);
      float star = smoothstep(.10,.0,d) * (l==0.?1.:.6) * tw;
      col += vec3(star) * mix(vec3(.75,.82,1.), vec3(.95,.9,1.), h);
    }
  }

  // vignette to page black
  float vig = smoothstep(1.25,.35,length(st));
  col *= vig;

  // subtle film grain
  col += (hash(gl_FragCoord.xy + u_time)-.5) * .015;

  gl_FragColor = vec4(col, 1.);
}
`;

export default function ShaderBackground({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return; // CSS gradient fallback behind us

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');

    let raf = 0;
    const start = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const frame = () => {
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame(); // first frame always (also the only one when reduced-motion)

    return () => {
      cancelAnimationFrame(raf);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <div className={`absolute inset-0 overflow-hidden bg-gradient-to-br from-[#05070f] via-[#0a0f22] to-[#0d0a1a] ${className}`} aria-hidden>
      <canvas ref={ref} className="absolute inset-0 w-full h-full" />
      {/* the dither language, over the nebula — one texture system everywhere */}
      <div className="absolute inset-0 tex-dither opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#05070a]" />
    </div>
  );
}
