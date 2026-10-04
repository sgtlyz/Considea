"use strict";
(() => {
  const $ = (s) => document.querySelector(s),
    $$ = (s) => document.querySelectorAll(s);
  let lang = "en";
  // A procedural monochrome material. The reading desk is fully opaque.
  const canvas = $("#liquid");
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  let program,
    uniforms,
    raf = 0,
    lastFrame = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (gl) {
    const vertex = "attribute vec2 a; void main(){gl_Position=vec4(a,0.,1.);}";
    const fragment = `precision mediump float;uniform vec2 res;uniform float time;uniform float lightMode;
float field(vec2 p){float t=time*.035;p+=.32*vec2(sin(p.y*.9+t),cos(p.x*.8-t*.7));float a=sin(p.x*1.5+sin(p.y*1.3+t)*1.2+t);float b=cos(p.y*1.7+cos(p.x*1.2-t)*1.15-t*.6);float c=sin(p.x*.66+p.y*.86+t*.5);return a*.48+b*.4+c*.3;}
void main(){vec2 uv=gl_FragCoord.xy/res;vec2 p=(uv-.5)*vec2(res.x/res.y,1.)*5.5;float h=field(p);float e=.023;vec3 n=normalize(vec3((field(p+vec2(e,0.))-h)/e,(field(p+vec2(0.,e))-h)/e,1.15));vec3 r=reflect(vec3(0.,0.,-1.),n);float env=pow(.5+.5*sin(r.x*4.5+r.y*2.8+1.2),7.);float spec=pow(max(dot(n,normalize(vec3(-.55,.8,.6))),0.),13.);float rim=pow(1.-n.z,2.);float valley=smoothstep(-.8,.8,h);float metal=.045+env*.33+spec*.27+rim*.12+valley*.055;vec3 dark=vec3(metal*.96,metal*.98,metal);float pearl=.83+env*.11+spec*.14-rim*.19-(1.-valley)*.045;vec3 bright=vec3(pearl*.986,pearl*.995,pearl*.98);gl_FragColor=vec4(mix(dark,bright,lightMode),1.);}`;
    function shader(type, src) {
      let s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("Liquid material unavailable");
        return null;
      }
      return s;
    }
    const vs = shader(gl.VERTEX_SHADER, vertex),
      fs = shader(gl.FRAGMENT_SHADER, fragment);
    if (vs && fs) {
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const a = gl.getAttribLocation(program, "a");
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
        uniforms = {
          res: gl.getUniformLocation(program, "res"),
          time: gl.getUniformLocation(program, "time"),
          light: gl.getUniformLocation(program, "lightMode"),
        };
      } else program = null;
    }
  }
  let materialTime = 0,
    lastTick = 0;
  function resizeLiquid() {
    canvas.width = Math.min(1100, innerWidth);
    canvas.height = Math.round((canvas.width * innerHeight) / innerWidth);
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    drawLiquid(performance.now());
    void 0;
  }
  function drawLiquid(now) {
    if (!gl || !program || !uniforms) return;
    gl.uniform2f(uniforms.res, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, materialTime);
    gl.uniform1f(
      uniforms.light,
      document.documentElement.dataset.theme === "light" ? 1 : 0,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function animate(now) {
    if (document.hidden || reduced.matches) {
      raf = 0;
      lastTick = 0;
      return;
    }
    if (now - lastFrame > 40) {
      if (lastTick) materialTime += (now - lastTick) / 1000;
      lastTick = now;
      lastFrame = now;
      drawLiquid(now);
    }
    raf = requestAnimationFrame(animate);
  }
  let loggedIn = false;
  function startMotion() {
    if (
      program &&
      loggedIn &&
      !raf &&
      !reduced.matches &&
      !document.hidden
    )
      raf = requestAnimationFrame(animate);
  }
  function updateFocusLabel() {
    let focused = document.documentElement.classList.contains("focus-mode");
    $$("[data-focus-toggle]").forEach((b) => {
      b.textContent =
        lang === "en"
          ? focused
            ? "Show the atmosphere"
            : "Focus on the discussion"
          : focused
            ? "展开氛围背景"
            : "专注讨论";
      b.setAttribute("aria-pressed", String(focused));
    });
  }
  $$("[data-focus-toggle]").forEach(
    (b) =>
      (b.onclick = () => {
        document.documentElement.classList.toggle("focus-mode");
        updateFocusLabel();
        drawLiquid(performance.now());
      }),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTick = 0;
    } else startMotion();
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTick = 0;
    } else startMotion();
  });
  window.addEventListener("resize", resizeLiquid);
  const coverCanvas = $("#cover-liquid");
  const coverGl = coverCanvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    powerPreference: "low-power",
  });
  let coverProgram = null,
    coverUniforms = null,
    coverFrame = 0,
    coverLast = 0,
    coverTime = 0;
  const coverPointer = { x: 0.5, y: 0.5 };
  if (coverGl) {
    const vertex =
      "attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}";
    const fragment = `precision mediump float;
 uniform vec2 resolution;uniform float time;uniform vec2 pointer;
 float field(vec2 p){
  float t=time*.075;
  p+=vec2(sin(p.y*.75+t)*.47,cos(p.x*.6-t*.7)*.43);
  float v=sin(p.x*1.35+p.y*.6+t);
  v+=.57*sin(p.y*2.2-p.x*.55-t*.7);
  v+=.25*sin(p.x*3.7+p.y*2.5+t*.45);
  v+=.08*sin(p.y*7.5-p.x*4.2-t*.35);
  return v;
 }
 void main(){
  vec2 uv=gl_FragCoord.xy/resolution;
  vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.)*4.5;
  p+=vec2(-.12,.08)+(pointer-.5)*.16;
  p=mat2(.86,-.5,.5,.86)*p;
  float f=field(p),e=.018;
  vec2 grad=vec2(field(p+vec2(e,0.))-f,field(p+vec2(0.,e))-f)/e;
  vec3 normal=normalize(vec3(-grad*.85,1.));
  vec3 light=normalize(vec3(-.7,.75,.45));
  float diffuse=max(0.,dot(normal,light));
  float spec=pow(max(0.,dot(reflect(-light,normal),vec3(0.,0.,1.))),18.);
  float broad=pow(abs(sin(f*1.9+time*.018)),12.);
  float fine=pow(abs(sin(f*2.85)),45.);
  float tone=.023+.09*diffuse+.53*broad*(.35+.65*diffuse)+.35*spec+.12*fine;
  float edge=1.-.32*smoothstep(.3,.9,length((uv-.5)*vec2(1.,.8)));
  vec3 color=vec3(tone*.96,tone*.98,tone)*edge;
  gl_FragColor=vec4(color,1.);
 }`;
    function compileCoverShader(type, source) {
      const shader = coverGl.createShader(type);
      coverGl.shaderSource(shader, source);
      coverGl.compileShader(shader);
      return coverGl.getShaderParameter(shader, coverGl.COMPILE_STATUS)
        ? shader
        : null;
    }
    const vs = compileCoverShader(coverGl.VERTEX_SHADER, vertex),
      fs = compileCoverShader(coverGl.FRAGMENT_SHADER, fragment);
    if (vs && fs) {
      coverProgram = coverGl.createProgram();
      coverGl.attachShader(coverProgram, vs);
      coverGl.attachShader(coverProgram, fs);
      coverGl.linkProgram(coverProgram);
      if (coverGl.getProgramParameter(coverProgram, coverGl.LINK_STATUS)) {
        coverGl.useProgram(coverProgram);
        const buffer = coverGl.createBuffer();
        coverGl.bindBuffer(coverGl.ARRAY_BUFFER, buffer);
        coverGl.bufferData(
          coverGl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
          coverGl.STATIC_DRAW,
        );
        const position = coverGl.getAttribLocation(coverProgram, "position");
        coverGl.enableVertexAttribArray(position);
        coverGl.vertexAttribPointer(position, 2, coverGl.FLOAT, false, 0, 0);
        coverUniforms = {
          resolution: coverGl.getUniformLocation(coverProgram, "resolution"),
          time: coverGl.getUniformLocation(coverProgram, "time"),
          pointer: coverGl.getUniformLocation(coverProgram, "pointer"),
        };
        coverCanvas.dataset.renderer = "webgl";
      } else coverProgram = null;
    }
  }
  function drawCover() {
    if (!coverGl || !coverProgram || !coverUniforms) return;
    coverGl.useProgram(coverProgram);
    coverGl.uniform2f(
      coverUniforms.resolution,
      coverCanvas.width,
      coverCanvas.height,
    );
    coverGl.uniform1f(coverUniforms.time, coverTime);
    coverGl.uniform2f(coverUniforms.pointer, coverPointer.x, coverPointer.y);
    coverGl.drawArrays(coverGl.TRIANGLES, 0, 6);
  }
  function resizeCover() {
    if (loggedIn) return;
    const rect = coverCanvas.getBoundingClientRect(),
      scale = Math.min(devicePixelRatio || 1, 1.4);
    coverCanvas.width = Math.max(1, Math.round(rect.width * scale));
    coverCanvas.height = Math.max(1, Math.round(rect.height * scale));
    if (coverGl) coverGl.viewport(0, 0, coverCanvas.width, coverCanvas.height);
    drawCover();
  }
  function animateCover(now) {
    if (loggedIn || document.hidden || reduced.matches) {
      coverFrame = 0;
      coverLast = 0;
      return;
    }
    if (coverLast) coverTime += Math.min((now - coverLast) / 1000, 0.05);
    coverLast = now;
    drawCover();
    coverFrame = requestAnimationFrame(animateCover);
  }
  function startCover() {
    if (
      !loggedIn &&
      !coverFrame &&
      !reduced.matches &&
      !document.hidden &&
      coverProgram
    )
      coverFrame = requestAnimationFrame(animateCover);
  }
  $("#landing").addEventListener("pointermove", (event) => {
    const rect = $("#landing").getBoundingClientRect();
    coverPointer.x = (event.clientX - rect.left) / rect.width;
    coverPointer.y = 1 - (event.clientY - rect.top) / rect.height;
    if (reduced.matches) drawCover();
  });
  window.addEventListener("resize", resizeCover);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && coverFrame) {
      cancelAnimationFrame(coverFrame);
      coverFrame = 0;
      coverLast = 0;
    } else startCover();
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches && coverFrame) {
      cancelAnimationFrame(coverFrame);
      coverFrame = 0;
      coverLast = 0;
      drawCover();
    } else startCover();
  });

  window.consideaAtmosphere = {
    home() {
      loggedIn = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastTick = 0;
      coverLast = 0;
      resizeCover();
      startCover();
    },
    enter() {
      loggedIn = true;
      if (coverFrame) {
        cancelAnimationFrame(coverFrame);
        coverFrame = 0;
      }
      coverLast = 0;
      resizeLiquid();
      startMotion();
    },
    language(value) {
      lang = value;
      updateFocusLabel();
    },
    theme() {
      drawLiquid(performance.now());
    },
  };
  resizeLiquid();
  resizeCover();
  startCover();
  updateFocusLabel();
})();
