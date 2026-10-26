// viewer.js: a small 3D atom viewer drawn on a plain canvas, with no outside library.
// It supports dragging to rotate, preset views, zoom, a slow spin, hovering and clicking on atoms.

import { ELEMENTS } from './data.js'; // metallic radii, used to size the metal atoms

const GAS_RADIUS = { C: 0.42, O: 0.4, S: 0.62 }; // drawn sizes of gas atoms in angstrom, smaller than real so bonds stay visible
const TAU = Math.PI * 2; // a full circle in radians, used when drawing round atoms

function isDark() { // true when dark colours are showing on the page
  const t = document.documentElement.dataset.theme; // the theme the visitor chose, if any
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches); // otherwise follow the computer
}

function palette() { // colours for atoms and guides in the current theme
  const css = getComputedStyle(document.documentElement); // read the page colour variables
  const v = (n) => css.getPropertyValue(n).trim() || '#888'; // one variable with a grey fallback
  const dark = isDark(); // which set to use
  return { // the colours
    metal: dark ? '#8da3b8' : '#7f93a8', // steel blue grey for metal atoms
    C: dark ? '#b0b0b0' : '#4a4a4a', // carbon is dark grey, lighter on a dark page
    O: '#e0453a', // oxygen is red in every chemistry book
    S: '#e6c13a', // sulfur is yellow in every chemistry book
    accent: v('--accent'), // the page accent colour for selections
    line: v('--line-2'), // thin lines such as the cell outline
    text: v('--text-2'), // label text
    bg: v('--surface'), // label backgrounds
  };
}

function mix(hex, to, f) { // blends a hex colour toward white or black by a fraction, used for shading spheres
  const n = parseInt(hex.slice(1), 16); // the colour as a number
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; // red, green and blue parts
  const t = to === 'white' ? 255 : 0; // the colour to blend toward
  return `rgb(${c.map((x) => Math.round(x + (t - x) * f)).join(',')})`; // the blended colour as text
}

export function slabScene(slab, selected = -1, pickable = true) { // builds the drawing list for a bare surface
  const atoms = []; // every atom to draw
  const [a1, a2] = slab.cell; // the two sideways cell vectors
  for (let i = -1; i <= 1; i++) { // one cell to the left, the middle, one to the right
    for (let j = -1; j <= 1; j++) { // the same in the other direction
      slab.atoms.forEach((a, k) => { // each atom of the surface
        const mid = i === 0 && j === 0; // true for the real cell, false for the faded repeats
        atoms.push({ el: a.el, x: a.x + i * a1[0] + j * a2[0], y: a.y + i * a1[1] + j * a2[1], z: a.z, r: ELEMENTS[a.el] ? ELEMENTS[a.el].radius * 0.0048 : 1, tone: 'metal', alpha: mid ? 1 : 0.32, id: mid ? k : -1, top: mid && slab.topIndexes.includes(k), pick: mid && pickable && slab.topIndexes.includes(k), sel: mid && k === selected }); // one drawable atom
      });
    }
  }
  return { atoms, bonds: [], cell: slab.cell, guide: null }; // the scene
}

export function systemScene(sys) { // builds the drawing list for a surface with its gas above one top atom
  const base = slabScene(sys.slab, sys.slab.atoms.indexOf(sys.site), false); // the surface, with the chosen atom marked
  const start = base.atoms.length; // where the gas atoms begin in the list
  sys.gas.forEach((g) => base.atoms.push({ el: g.el, x: g.x, y: g.y, z: g.z, r: GAS_RADIUS[g.el] || 0.4, tone: g.el, alpha: 1, id: -1, top: false, pick: false, sel: false })); // add the gas atoms
  base.bonds = sys.bonds.map(([i, j]) => [start + i, start + j]); // bonds between gas atoms
  const low = sys.gas[0]; // the gas atom nearest the surface
  base.focus = { x: sys.site.x, y: sys.site.y, z: (sys.slab.topZ - 1.5 + low.z + 1) / 2, R: 4.6 }; // zoom in on the gas and the atoms around it so the molecule is easy to see
  base.guide = { from: [sys.site.x, sys.site.y, sys.slab.topZ], to: [low.x, low.y, low.z], label: `${sys.height.toFixed(1)} Å` }; // a dashed line showing the distance
  return base; // the scene
}

export function gasScene(g) { // builds the drawing list for one lone molecule
  const atoms = g.atoms.map((a) => ({ el: a.el, x: a.x, y: a.y, z: a.z, r: GAS_RADIUS[a.el] || 0.4, tone: a.el, alpha: 1, id: -1, top: false, pick: false, sel: false })); // the atoms
  return { atoms, bonds: g.bonds, cell: null, guide: null }; // no cell outline for a free molecule
}

export class Viewer { // the viewer itself
  constructor(canvas, opts = {}) { // canvas is the drawing surface, opts holds small settings
    this.cv = canvas; // keep the canvas
    this.ctx = canvas.getContext('2d'); // the 2D drawing tools
    this.yaw = opts.yaw ?? 0.6; // turn around the vertical axis in radians
    this.pitch = opts.pitch ?? 0.85; // how high the camera looks from, 0 is level and 1.57 is straight down
    this.zoom = opts.zoom ?? 1; // zoom factor
    this.fit = opts.fit ?? 1; // how much of the scene fills the canvas
    this.spin = false; // slow automatic turning is off until asked
    this.scene = null; // nothing to draw yet
    this.hover = -1; // the atom under the pointer
    this.onPick = opts.onPick || null; // called with an atom number when a pickable atom is clicked
    this.drawn = []; // screen positions of the atoms from the last drawing, used to find what was clicked
    this.visible = true; // false when scrolled out of view, so the spin can pause
    this.raf = 0; // the id of the pending animation frame
    this.size(); // set the canvas size
    this.bind(); // attach the mouse, touch and keyboard handlers
  }

  size() { // matches the canvas pixels to its size on screen, sharp on high resolution screens
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2 to keep it light
    const w = this.cv.clientWidth || 300; // width in screen pixels
    const h = this.cv.clientHeight || 200; // height in screen pixels
    this.cv.width = Math.round(w * dpr); // real pixel width
    this.cv.height = Math.round(h * dpr); // real pixel height
    this.W = w; this.H = h; this.dpr = dpr; // remember them for drawing
    this.draw(); // redraw at the new size
  }

  setScene(scene) { // shows a new set of atoms
    this.scene = scene; // keep it
    const pts = scene.atoms.filter((a) => a.alpha === 1); // the main atoms, not the faded repeats
    const xs = pts.map((a) => a.x), ys = pts.map((a) => a.y), zs = pts.map((a) => a.z); // their coordinates
    const lo = [Math.min(...xs), Math.min(...ys), Math.min(...zs)]; // smallest corner
    const hi = [Math.max(...xs), Math.max(...ys), Math.max(...zs)]; // largest corner
    this.c = scene.focus ? { x: scene.focus.x, y: scene.focus.y, z: scene.focus.z } : { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2 }; // the centre of the main atoms, or a chosen focus point
    this.R = scene.focus ? scene.focus.R : Math.max(1.5, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2); // half the size of the scene, or the focus size
    this.draw(); // draw it
  }

  setView(name) { // jumps to a preset angle
    if (name === 'top') { this.pitch = Math.PI / 2; this.yaw = 0; } // straight down
    else if (name === 'side') { this.pitch = 0.08; this.yaw = 0; } // almost level, so the layers can be counted
    else { this.pitch = 0.85; this.yaw = 0.6; } // a friendly three quarter angle
    this.draw(); // redraw
  }

  zoomBy(f) { this.zoom = Math.min(3, Math.max(0.5, this.zoom * f)); this.draw(); } // changes the zoom within sensible limits

  setSpin(on) { // turns the slow rotation on or off
    this.spin = on; // remember the choice
    if (on) this.loop(); // start the animation
  }

  loop() { // one step of the slow rotation
    cancelAnimationFrame(this.raf); // never run two loops at once
    if (!this.spin) return; // stopped
    if (this.visible) { this.yaw += 0.006; this.draw(); } // turn a little and redraw, only when on screen
    this.raf = requestAnimationFrame(() => this.loop()); // ask for the next step
  }

  project(x, y, z, k) { // turns a 3D point into a screen point plus a depth value
    const X = x - this.c.x, Y = y - this.c.y, Z = z - this.c.z; // relative to the centre
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), ce = Math.cos(this.pitch), se = Math.sin(this.pitch); // the angles as numbers
    const x1 = X * cy - Y * sy, y1 = X * sy + Y * cy; // turn around the vertical axis
    return { sx: this.W / 2 + x1 * k, sy: this.H / 2 - (y1 * se + Z * ce) * k, d: -y1 * ce + Z * se }; // screen x, screen y and depth toward the viewer
  }

  draw() { // paints the whole scene
    const { ctx, W, H, dpr } = this; // short names
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in screen pixels whatever the sharpness
    ctx.clearRect(0, 0, W, H); // wipe the previous picture
    this.drawn = []; // forget the old click targets
    if (!this.scene) return; // nothing to draw
    const sc = this.scene; // the atoms to show
    const pal = palette(); // colours for this theme
    const k = (Math.min(W, H) * 0.5 * this.fit * this.zoom) / (this.R * 1.25); // pixels per angstrom
    const items = []; // everything with a depth, to be drawn far to near
    sc.atoms.forEach((a, i) => { const p = this.project(a.x, a.y, a.z, k); items.push({ t: 'atom', a, i, p }); }); // atoms
    sc.bonds.forEach(([i, j]) => { const p = this.project(sc.atoms[i].x, sc.atoms[i].y, sc.atoms[i].z, k), q = this.project(sc.atoms[j].x, sc.atoms[j].y, sc.atoms[j].z, k); items.push({ t: 'bond', p, q, p2: { d: (p.d + q.d) / 2 } }); }); // bonds, placed at their middle depth
    items.sort((u, v) => (u.t === 'bond' ? u.p2.d : u.p.d) - (v.t === 'bond' ? v.p2.d : v.p.d)); // far items first
    if (sc.cell) this.drawCell(sc, k, pal); // the outline of the real cell goes behind everything
    for (const it of items) { // paint each item
      if (it.t === 'bond') this.drawBond(it, k, pal); // a stick between two atoms
      else this.drawAtom(it, k, pal); // a ball
    }
    if (sc.guide) this.drawGuide(sc.guide, k, pal); // the distance marker goes on top
  }

  drawCell(sc, k, pal) { // draws the box edges of the real simulation cell
    const [a, b] = sc.cell; // the two sideways vectors
    const zs = sc.atoms.map((t) => t.z); // heights of all atoms
    const z0 = Math.min(...zs) - 0.6, z1 = Math.max(...zs) + 1.0; // bottom and top of the drawn box
    const corner = (i, j, z) => this.project(i * a[0] + j * b[0], i * a[1] + j * b[1], z, k); // one corner of the box
    const c = [[0, 0], [1, 0], [1, 1], [0, 1]]; // the four corners of the floor
    const ctx = this.ctx; // the drawing tools
    ctx.save(); // keep the settings tidy
    ctx.strokeStyle = pal.line; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.9; // thin dashed grey lines
    for (let e = 0; e < 4; e++) { // each side of the box
      const [i, j] = c[e], [i2, j2] = c[(e + 1) % 4]; // two neighbouring corners
      for (const z of [z0, z1]) { const p = corner(i, j, z), q = corner(i2, j2, z); ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(q.sx, q.sy); ctx.stroke(); } // the floor and the ceiling edge
      const p = corner(i, j, z0), q = corner(i, j, z1); ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(q.sx, q.sy); ctx.stroke(); // the upright edge
    }
    ctx.restore(); // put the settings back
  }

  drawBond(it, k, pal) { // draws a bond as a thick rounded line
    const ctx = this.ctx; // the drawing tools
    ctx.save(); // keep settings tidy
    ctx.strokeStyle = pal.text; ctx.globalAlpha = 0.75; ctx.lineWidth = Math.max(2.5, k * 0.16); ctx.lineCap = 'round'; // a grey stick that scales with zoom
    ctx.beginPath(); ctx.moveTo(it.p.sx, it.p.sy); ctx.lineTo(it.q.sx, it.q.sy); ctx.stroke(); // draw it
    ctx.restore(); // put the settings back
  }

  drawAtom(it, k, pal) { // draws one shaded ball, with rings for selection and hover
    const { a, p } = it; // the atom and its screen position
    const r = Math.max(3, a.r * k); // radius in pixels
    const base = pal[a.tone] || pal.metal; // its colour
    const ctx = this.ctx; // the drawing tools
    ctx.save(); // keep settings tidy
    ctx.globalAlpha = a.alpha; // faded for the repeated cells
    const g = ctx.createRadialGradient(p.sx - r * 0.35, p.sy - r * 0.4, r * 0.1, p.sx, p.sy, r); // a light spot toward the top left
    g.addColorStop(0, mix(base, 'white', 0.55)); g.addColorStop(0.55, base); g.addColorStop(1, mix(base, 'black', 0.35)); // light, true and dark colours
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, TAU); ctx.fill(); // the ball
    if (a.top && this.scene.atoms.some((t) => t.pick)) { ctx.strokeStyle = pal.accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.sx, p.sy, r + 3, 0, TAU); ctx.stroke(); } // a faint ring marks the atoms that can be clicked
    if (a.sel || it.i === this.hover) { ctx.globalAlpha = 1; ctx.strokeStyle = pal.accent; ctx.lineWidth = a.sel ? 3 : 2; ctx.beginPath(); ctx.arc(p.sx, p.sy, r + 4, 0, TAU); ctx.stroke(); } // a strong ring for the chosen or hovered atom
    ctx.restore(); // put the settings back
    if (a.pick) this.drawn.push({ i: it.i, id: a.id, sx: p.sx, sy: p.sy, r: r + 4 }); // remember where it is so it can be clicked
  }

  drawGuide(g, k, pal) { // draws a dashed line with a distance label
    const p = this.project(g.from[0], g.from[1], g.from[2], k), q = this.project(g.to[0], g.to[1], g.to[2], k); // both ends on screen
    const ctx = this.ctx; // the drawing tools
    ctx.save(); // keep settings tidy
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); // a dashed accent line
    ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(q.sx, q.sy); ctx.stroke(); // draw it
    ctx.setLineDash([]); ctx.font = '600 12px system-ui, sans-serif'; // solid lines and a small bold font for the label
    const mx = (p.sx + q.sx) / 2 + 10, my = (p.sy + q.sy) / 2; // beside the middle of the line
    const w = ctx.measureText(g.label).width + 10; // label width with padding
    ctx.fillStyle = pal.bg; ctx.globalAlpha = 0.9; ctx.fillRect(mx - 4, my - 9, w, 18); // a background so the text stays readable
    ctx.globalAlpha = 1; ctx.fillStyle = pal.accent; ctx.textBaseline = 'middle'; ctx.fillText(g.label, mx + 1, my); // the text itself
    ctx.restore(); // put the settings back
  }

  hit(ev) { // finds the clickable atom under the pointer, nearest to the viewer first
    const r = this.cv.getBoundingClientRect(); // canvas position on the page
    const x = ev.clientX - r.left, y = ev.clientY - r.top; // pointer inside the canvas
    for (let n = this.drawn.length - 1; n >= 0; n--) { // later items are nearer
      const d = this.drawn[n]; // one clickable atom
      if (Math.hypot(x - d.sx, y - d.sy) <= d.r) return d; // inside its circle
    }
    return null; // nothing there
  }

  bind() { // attaches the input handlers
    const cv = this.cv; // short name
    let down = null; // where a press started
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, moved: 0 }; cv.setPointerCapture(e.pointerId); }); // start a drag
    cv.addEventListener('pointermove', (e) => { // while the pointer moves
      if (down && e.buttons) { // dragging with a button or finger down
        const dx = e.clientX - down.x, dy = e.clientY - down.y; // movement since the last event
        down.moved += Math.abs(dx) + Math.abs(dy); down.x = e.clientX; down.y = e.clientY; // update the totals
        this.yaw += dx * 0.01; this.pitch = Math.min(Math.PI / 2, Math.max(0.05, this.pitch + dy * 0.008)); // turn and tilt, tilt is limited
        this.draw(); // show the new angle
      } else { // just hovering
        const h = this.hit(e); const id = h ? h.i : -1; // the atom under the pointer
        if (id !== this.hover) { this.hover = id; cv.style.cursor = h ? 'pointer' : 'grab'; this.draw(); } // update the ring and the cursor
      }
    });
    cv.addEventListener('pointerup', (e) => { // when the press ends
      if (down && down.moved < 5 && this.onPick) { const h = this.hit(e); if (h) this.onPick(h.id); } // a tap, not a drag, so treat it as a click
      down = null; // forget the press
    });
    cv.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.draw(); } }); // clear the hover ring
    cv.addEventListener('keydown', (e) => { // keyboard control for people without a mouse
      const step = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key]; // arrow keys rotate
      if (step) { e.preventDefault(); this.yaw += step[0]; this.pitch = Math.min(Math.PI / 2, Math.max(0.05, this.pitch + step[1])); this.draw(); } // apply the turn
      if (e.key === '+' || e.key === '=') this.zoomBy(1.15); // plus zooms in
      if (e.key === '-') this.zoomBy(1 / 1.15); // minus zooms out
    });
    new ResizeObserver(() => this.size()).observe(cv); // redraw sharply when the size changes
    new IntersectionObserver((en) => { this.visible = en[0].isIntersecting; }).observe(cv); // note when it is scrolled out of view
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw()); // repaint when the computer theme changes
    new MutationObserver(() => this.draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); // repaint when the theme button is used
  }
}
