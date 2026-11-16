"use strict";

const $ = selector => document.querySelector(selector);
const data = window.mriDataset;
const palette = { 1: [86, 180, 233], 2: [230, 159, 0], 3: [217, 85, 165], 4: [106, 240, 177] };
const diffColors = { agree: [89, 223, 178], reference: [100, 181, 255], prediction: [255, 183, 94], mismatch: [255, 118, 178] };
const planes = [
  { name: "Axial", axis: 2, horizontal: 0, vertical: 1, directions: ["A", "P", "L", "R"] },
  { name: "Coronal", axis: 1, horizontal: 0, vertical: 2, directions: ["S", "I", "L", "R"] },
  { name: "Sagittal", axis: 0, horizontal: 1, vertical: 2, directions: ["S", "I", "P", "A"] }
];
const axisNames = ["X", "Y", "Z"];
const initialCamera = { yaw: -1.03, pitch: 0.40, zoom: 1.18 };
const state = { case: null, payload: null, cursor: null, sequence: 0, mode: "reference", opacity: .58,
                visible: new Set([1, 2, 3]), camera: { ...initialCamera }, fitAll: false, recovery: false };
const caseSelect = $("#case-select");
const sequence = $("#sequence");
const notice = $("#notice");

function scheduleSurfaces() {
  if (scheduleSurfaces.pending) return;
  scheduleSurfaces.pending = true;
  requestAnimationFrame(() => {
    scheduleSurfaces.pending = false;
    const visible = new Set(state.visible);
    if (visible.has(1)) visible.add(4);
    for (const surface of surfaces) surface?.draw(state.camera, visible, palette);
  });
}
const surfaces = ["#reference-3d", "#prediction-3d"].map(id => {
  const canvas = $(id);
  try {
    return new SurfaceView(canvas, scheduleSurfaces);
  } catch (error) {
    console.error(error);
    canvas.hidden = true;
    canvas.parentElement.querySelector(".surface-error").hidden = false;
    return null;
  }
});
function zoom(factor) {
  state.camera.zoom = Math.max(.48, Math.min(4.0, state.camera.zoom * factor));
  scheduleSurfaces();
}
function rotate(dx, dy) {
  state.camera.yaw += dx;
  state.camera.pitch = Math.max(-1.54, Math.min(1.54, state.camera.pitch + dy));
  scheduleSurfaces();
}
for (const surface of surfaces) {
  if (!surface?.gl) continue;
  let pointer = null;
  const canvas = surface.canvas;
  canvas.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointer = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointermove", e => {
    if (!pointer || !canvas.hasPointerCapture(e.pointerId)) return;
    rotate(-(e.clientX - pointer[0]) * .012, (e.clientY - pointer[1]) * .010);
    pointer = [e.clientX, e.clientY];
  });
  canvas.addEventListener("lostpointercapture", () => { pointer = null; });
  canvas.addEventListener("wheel", e => {
    if (!state.payload) return;
    e.preventDefault();
    zoom(Math.exp(-e.deltaY * .0014));
  }, { passive: false });
  canvas.addEventListener("keydown", e => {
    const moves = { ArrowLeft: [.14, 0], ArrowRight: [-.14, 0], ArrowUp: [0, -.14], ArrowDown: [0, .14] };
    if (moves[e.key]) rotate(...moves[e.key]);
    else if (e.key === "+" || e.key === "=") zoom(1.18);
    else if (e.key === "-") zoom(1 / 1.18);
    else return;
    e.preventDefault();
  });
}
$("#zoom-in").onclick = () => zoom(1.2);
$("#zoom-out").onclick = () => zoom(1 / 1.2);
function setFraming(fitAll) {
  state.fitAll = fitAll;
  const control = $("#framing");
  control.setAttribute("aria-pressed", String(fitAll));
  control.textContent = fitAll ? "Focus on annotation" : "Fit all";
  for (const surface of surfaces) surface?.setFraming(fitAll);
  scheduleSurfaces();
}
$("#framing").onclick = () => {
  state.camera.zoom = initialCamera.zoom;
  setFraming(!state.fitAll);
};
$("#reset-view").onclick = () => { state.camera = { ...initialCamera }; setFraming(false); };

const sliceViews = planes.map(plane => {
  const card = document.createElement("article");
  card.className = "slice";
  const directionMarkup = ["top", "bottom", "left", "right"].map((side, i) =>
    '<span class="orientation ' + side + '" aria-hidden="true">' + plane.directions[i] + "</span>"
  ).join("");
  card.innerHTML = '<div class="slice-head"><span>' + plane.name + '</span><output></output></div>' +
    '<div class="slice-image"><canvas tabindex="0" aria-label="' + plane.name + ' MRI"></canvas>' + directionMarkup +
    '</div><input type="range" min="0" value="0" aria-label="' + plane.name + ' slice">';
  $("#slice-grid").appendChild(card);
  const canvas = card.querySelector("canvas");
  const slider = card.querySelector("input");
  slider.oninput = () => {
    if (!state.cursor) return;
    state.cursor[plane.axis] = Number(slider.value);
    drawSlices();
  };
  canvas.addEventListener("click", e => {
    if (!state.cursor) return;
    const rect = canvas.getBoundingClientRect();
    const u = Math.floor((e.clientX - rect.left) / rect.width * canvas.width);
    const v = Math.floor((e.clientY - rect.top) / rect.height * canvas.height);
    state.cursor[plane.horizontal] = Math.min(canvas.width - 1, Math.max(0, u));
    state.cursor[plane.vertical] = canvas.height - 1 - Math.min(canvas.height - 1, Math.max(0, v));
    drawSlices();
  });
  canvas.addEventListener("keydown", e => {
    if (!state.cursor || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const axis = e.key === "ArrowUp" || e.key === "ArrowDown" ? plane.vertical : plane.horizontal;
    const step = e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 1;
    state.cursor[axis] = Math.max(0, Math.min(state.payload.meta.shape[axis] - 1, state.cursor[axis] + step));
    drawSlices();
    e.preventDefault();
  });
  return { ...plane, canvas, slider, position: card.querySelector("output"), ctx: canvas.getContext("2d") };
});

function overlayColor(reference, prediction, added) {
  if (state.mode === "additions") return added && state.visible.has(1) ? palette[4] : null;
  if (state.mode === "off") return null;
  const ref = state.visible.has(reference) ? reference : 0;
  const pred = state.visible.has(prediction) ? prediction : 0;
  if (state.mode === "reference") return palette[ref];
  if (state.mode === "prediction") return added && state.recovery && pred ? palette[4] : palette[pred];
  if (!ref && !pred) return null;
  if (ref === pred) return diffColors.agree;
  if (!ref) return diffColors.prediction;
  if (!pred) return diffColors.reference;
  return diffColors.mismatch;
}

function drawSlices() {
  if (!state.payload) return;
  const { meta, bytes } = state.payload;
  const [nx, ny, nz] = meta.shape;
  const voxels = nx * ny * nz;
  const stride = [1, nx, nx * ny];
  for (const view of sliceViews) {
    const { axis, horizontal, vertical, canvas, ctx, slider, position } = view;
    const width = meta.shape[horizontal], height = meta.shape[vertical];
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.aspectRatio = (width * meta.spacing[horizontal]) + " / " + (height * meta.spacing[vertical]);
    const image = ctx.createImageData(width, height);
    const fixed = state.cursor[axis] * stride[axis];
    const base = state.sequence * voxels;
    let p = 0;
    for (let row = 0; row < height; row++) {
      const rowStart = fixed + (height - 1 - row) * stride[vertical];
      for (let col = 0; col < width; col++) {
        const index = rowStart + col * stride[horizontal];
        const gray = bytes[base + index];
        const baseline = bytes[5 * voxels + index];
        const recovered = meta.recovery ? bytes[6 * voxels + index] : baseline;
        const color = overlayColor(bytes[4 * voxels + index], state.recovery ? recovered : baseline, recovered !== baseline);
        for (let c = 0; c < 3; c++) image.data[p++] = color ? gray + (color[c] - gray) * state.opacity : gray;
        image.data[p++] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const cx = state.cursor[horizontal] + .5;
    const cy = height - state.cursor[vertical] - .5;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(181,234,227,.75)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, cy - 4);
    ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, height);
    ctx.moveTo(0, cy); ctx.lineTo(cx - 4, cy);
    ctx.moveTo(cx + 4, cy); ctx.lineTo(width, cy);
    ctx.stroke();
    slider.max = String(meta.shape[axis] - 1);
    slider.value = String(state.cursor[axis]);
    position.value = axisNames[axis] + " " + state.cursor[axis] + " / " + slider.max;
  }
  $("#position").textContent = state.cursor.map((v, i) => axisNames[i] + " " + v).join("  ·  ");
  $("#spacing").textContent = "RAS+ orientation · " + meta.spacing.join(" × ") + " mm voxels";
}

const formatScore = value => value === null ? "—" : value.toFixed(3);
function showMetrics(row) {
  $("#metrics").replaceChildren(...Object.entries(state.recovery ? Object.fromEntries(Object.keys(row.dice).map(k => [k, state.payload.meta.recovery.metrics[k]])) : row.dice).map(([region, score]) => {
    const card = document.createElement("article");
    card.className = "metric";
    const name = document.createElement("h3");
    name.textContent = region[0].toUpperCase() + region.slice(1);
    const mean = document.createElement("small");
    mean.textContent = state.recovery ? "Boundary recovery · this case" : "Current model · this case";
    const value = document.createElement("strong");
    value.textContent = formatScore(score);
    card.append(name, mean, value);
    return card;
  }));
}

function readCaseAsset(caseId) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = caseId + ".js";
    script.onload = () => {
      const payload = window.mriPayload;
      delete window.mriPayload;
      script.remove();
      if (payload) resolve(payload);
      else reject(new Error("The case file contained no MRI data."));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("The case file could not be opened. Keep the viewer folder and its files together."));
    };
    document.head.appendChild(script);
  });
}

async function selectCase(caseId) {
  const row = data.cases.find(item => item.case === caseId);
  if (!row) return;
  caseSelect.disabled = true;
  $("#recovery-toggle").disabled = true;
  $("#focus-additions").disabled = true;
  notice.classList.remove("error");
  notice.textContent = "Loading " + caseId + "…";
  try {
    const { meta, gzip } = await readCaseAsset(caseId);
    const zipped = Uint8Array.fromBase64
      ? Uint8Array.fromBase64(gzip)
      : Uint8Array.from(atob(gzip), c => c.charCodeAt(0));
    const stream = new Blob([zipped]).stream().pipeThrough(new DecompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (bytes.length !== meta.byteLength) throw new Error("The case data were incomplete.");
    state.case = caseId;
    state.payload = { meta, bytes };
    state.cursor = [...meta.focus];
    state.camera = { ...initialCamera };
    for (const [index, surface] of surfaces.entries()) surface?.setData(state.payload, index === 1 && state.recovery && meta.recovery ? 2 : index);
    setFraming(false);
    updateRecovery();
    drawSlices();
    scheduleSurfaces();
    notice.textContent = "";
  } catch (error) {
    console.error(error);
    if (state.case) caseSelect.value = state.case;
    notice.classList.add("error");
    notice.textContent = error.message;
  } finally {
    caseSelect.disabled = false;
    $("#recovery-toggle").disabled = !state.payload?.meta.recovery;
    $("#focus-additions").disabled = !state.payload?.meta.addedFocus;
  }
}

function updateRecovery() {
  if (!state.payload) return;
  const info = state.payload.meta.recovery;
  if (!info) state.recovery = false;
  $("#recovery-toggle").checked = state.recovery;
  $("#prediction-title").textContent = state.recovery ? "Retrained baseline + boundary recovery" : "Retrained baseline";
  $("#prediction-subtitle").textContent = state.recovery ? "Mint = added oedema" : "Saved checkpoint";
  $("#recovery-summary").textContent = info
    ? (state.recovery ? "Recovery on. " : "Recovery off. ") + "Adds " + info.addedMl.toFixed(2) + " mL (" + info.addedVoxels.toLocaleString() + " voxels) in this case. Existing tumour labels stay unchanged."
    : "Boundary recovery is unavailable for this case.";
  const surface = surfaces[1];
  surface?.setData(state.payload, state.recovery ? 2 : 1);
  surface?.setFraming(state.fitAll);
  showMetrics(data.cases.find(row => row.case === state.case));
  drawSlices();
  scheduleSurfaces();
}
$("#recovery-toggle").onchange = event => {
  state.recovery = event.target.checked;
  // Show the selected prediction immediately, keeping position and camera fixed.
  state.mode = "prediction";
  for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
  $("#difference-legend").hidden = true;
  updateRecovery();
};
$("#focus-additions").onclick = () => {
  if (!state.payload?.meta.addedFocus) return;
  state.cursor = [...state.payload.meta.addedFocus];
  document.querySelector('[data-mode="additions"]').click();
};

for (const button of document.querySelectorAll("[data-mode]")) {
  button.onclick = () => {
    state.mode = button.dataset.mode;
    if (state.mode === "additions" && state.payload?.meta.recovery) {
      state.recovery = true;
      $("#recovery-toggle").checked = true;
      updateRecovery();
    }
    for (const control of document.querySelectorAll("[data-mode]")) {
      control.setAttribute("aria-pressed", String(control === button));
    }
    $("#difference-legend").hidden = state.mode !== "difference";
    drawSlices();
  };
}
for (const input of document.querySelectorAll("[data-class]")) {
  input.onchange = () => {
    const id = Number(input.dataset.class);
    if (input.checked) state.visible.add(id); else state.visible.delete(id);
    drawSlices();
    scheduleSurfaces();
  };
}
$("#opacity").oninput = event => {
  state.opacity = Number(event.target.value) / 100;
  $("#opacity-value").value = event.target.value + "%";
  drawSlices();
};
$("#focus").onclick = () => {
  if (!state.payload) return;
  state.cursor = [...state.payload.meta.focus];
  drawSlices();
};
sequence.onchange = () => { state.sequence = Number(sequence.value); drawSlices(); };
caseSelect.onchange = () => selectCase(caseSelect.value);

if (data) {
  for (const row of data.cases) caseSelect.add(new Option(row.case, row.case));
  for (const [index, name] of data.channels.entries()) sequence.add(new Option(name, index));
  $("#model-info").textContent = "Retrained baseline: 160 training content groups, epoch " + data.epoch +
    ". Recovery: 60 separate training groups, epoch " + data.recoveryEpoch + ", cutoff " + data.recoveryThreshold +
    ", radius " + data.recoveryRadius + " voxel steps. All " + data.test_cases +
    " displayed cases are held-out representatives from distinct detected content groups. No detected group crosses partitions; patient identity is not independently verified.";
  selectCase(caseSelect.value);
} else {
  notice.classList.add("error");
  notice.textContent = "Viewer data are missing. Keep index.html and its companion files together.";
}
