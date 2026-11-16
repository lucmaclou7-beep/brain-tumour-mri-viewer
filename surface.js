"use strict";

class SurfaceView {
  constructor(canvas, scheduleDraw) {
    this.canvas = canvas;
    this.meshes = [];
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true });
    if (!gl) {
      canvas.hidden = true;
      canvas.parentElement.querySelector(".surface-error").hidden = false;
      return;
    }
    this.gl = gl;
    const vertex = [
      "#version 300 es",
      "layout(location=0) in vec2 aCorner;",
      "layout(location=1) in vec3 aFace;",
      "uniform vec3 uU, uV, uSpacing, uCenter, uRight, uUp, uEye;",
      "uniform vec2 uScale;",
      "uniform float uDepth;",
      "void main() {",
      "  vec3 world = (aFace + uU*aCorner.x + uV*aCorner.y)*0.5*uSpacing - uCenter;",
      "  gl_Position = vec4(dot(world,uRight)*uScale.x, dot(world,uUp)*uScale.y, -dot(world,uEye)*uDepth, 1.0);",
      "}"
    ].join("\n");
    const fragment = [
      "#version 300 es",
      "precision mediump float;",
      "uniform vec3 uColor, uNormal, uLight;",
      "out vec4 outColor;",
      "void main() {",
      "  float shade = 0.56 + 0.44 * max(dot(uNormal,uLight),0.0);",
      "  outColor = vec4(uColor*shade,1.0);",
      "}"
    ].join("\n");
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    this.uniforms = Object.fromEntries(
      ["uU", "uV", "uSpacing", "uCenter", "uRight", "uUp", "uEye", "uScale", "uDepth", "uColor", "uNormal", "uLight"]
        .map(name => [name, gl.getUniformLocation(program, name)])
    );
    this.corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    this.resize = new ResizeObserver(scheduleDraw);
    this.resize.observe(canvas);
  }

  setData(payload, index) {
    if (!this.gl) return;
    const gl = this.gl;
    for (const mesh of this.meshes) gl.deleteBuffer(mesh.buffer);
    this.meshes = payload.meta.surfaces[index].map(desc => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Int16Array(payload.bytes.buffer, desc.offset, desc.count * 3), gl.STATIC_DRAW);
      const tangents = [0, 1, 2].filter(axis => axis !== desc.axis);
      const unit = axis => [0, 1, 2].map(i => Number(i === axis));
      const normal = unit(desc.axis);
      normal[desc.axis] = desc.side;
      return { ...desc, buffer, u: unit(tangents[0]), v: unit(tangents[1]), normal };
    });
    this.spacing = payload.meta.spacing;
    this.bounds = payload.meta.bounds;
    this.focusBounds = payload.meta.focusBounds;
    this.setFraming(false);
  }

  setFraming(fitAll) {
    if (!this.bounds) return;
    const [low, high] = fitAll ? this.bounds : this.focusBounds;
    this.center = low.map((v, i) => (v + high[i]) * this.spacing[i] / 2);
    this.radius = Math.max(8, Math.hypot(...high.map((v, i) => (v - low[i] + 1) * this.spacing[i])) / 2);
    const [allLow, allHigh] = this.bounds;
    this.depth = Math.max(this.radius, Math.hypot(...allHigh.map((v, i) => Math.max(
      Math.abs(allLow[i] * this.spacing[i] - this.center[i]),
      Math.abs(v * this.spacing[i] - this.center[i])
    ))));
  }

  draw(camera, visible, colors) {
    if (!this.gl) return;
    const { gl, canvas, uniforms: u } = this;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.center) return;

    const { yaw, pitch, zoom } = camera;
    const cos = Math.cos, sin = Math.sin;
    const eye = [cos(pitch) * cos(yaw), cos(pitch) * sin(yaw), sin(pitch)];
    const right = [-sin(yaw), cos(yaw), 0];
    const up = [-sin(pitch) * cos(yaw), -sin(pitch) * sin(yaw), cos(pitch)];
    const rawLight = eye.map((v, i) => v + 0.52 * up[i] - 0.32 * right[i]);
    const light = rawLight.map(v => v / Math.hypot(...rawLight));
    const aspect = width / height;
    const scale = 0.88 * zoom / this.radius;
    gl.useProgram(this.program);
    gl.uniform3fv(u.uSpacing, this.spacing);
    gl.uniform3fv(u.uCenter, this.center);
    gl.uniform3fv(u.uRight, right);
    gl.uniform3fv(u.uUp, up);
    gl.uniform3fv(u.uEye, eye);
    gl.uniform3fv(u.uLight, light);
    gl.uniform2f(u.uScale, scale / Math.max(1, aspect), scale * Math.min(1, aspect));
    gl.uniform1f(u.uDepth, 0.8 / this.depth);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribDivisor(1, 1);
    for (const mesh of this.meshes) {
      if (!visible.has(mesh.label)) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.vertexAttribPointer(1, 3, gl.SHORT, false, 0, 0);
      gl.uniform3fv(u.uU, mesh.u);
      gl.uniform3fv(u.uV, mesh.v);
      gl.uniform3fv(u.uNormal, mesh.normal);
      gl.uniform3fv(u.uColor, colors[mesh.label].map(v => v / 255));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, mesh.count);
    }
  }
}
