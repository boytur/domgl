/* Minimal 2D "stage" helpers shared by every scene.
 *
 * Two problems this solves:
 *   1. characters floating above / sinking under the floor
 *      -> Stage.snap() puts the soles exactly on a named floor element
 *   2. a camera push that reads as "the props are growing"
 *      -> Stage.camera() moves background / world / foreground at different
 *         rates around a single focus point, so it reads as depth, not scale
 *
 * Character SVG contract: viewBox 0 0 300 420, soles at y=410.
 */

(function () {
  var SOLE = 410;
  var VB_H = 420;

  function soleOf(el) {
    var r = el.getBoundingClientRect();
    return r.top + r.height * (SOLE / VB_H);
  }

  /**
   * Put every matched element's feet on the top edge of `floorSelector`.
   * Elements must share an offsetParent with the floor (a lift cabin, a room).
   */
  function snap(selector, floorSelector, opts) {
    var floor = document.querySelector(floorSelector);
    if (!floor) return [];
    var floorY = floor.getBoundingClientRect().top;
    var els = document.querySelectorAll(selector);
    var moved = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var delta = floorY - soleOf(el) - (opts && opts.gap ? opts.gap : 0);
      if (Math.abs(delta) < 0.5) {
        moved.push(0);
        continue;
      }
      el.style.top = (el.offsetTop + delta).toFixed(1) + "px";
      moved.push(Number(delta.toFixed(1)));
    }
    return moved;
  }

  /**
   * Parallax camera move. Layers tagged .cam-bg / .cam-world / .cam-fg
   * scale by different amounts around the same focus point.
   *
   *   Stage.camera(tl, { zoom: 0.05, duration: 3.6, origin: "540px 1200px" });
   */
  function camera(tl, opts) {
    opts = opts || {};
    var zoom = opts.zoom == null ? 0.045 : opts.zoom;
    var at = opts.at == null ? 0 : opts.at;
    var dur = opts.duration == null ? 3.6 : opts.duration;
    var ease = opts.ease || "none";
    var origin = opts.origin || "540px 1200px";
    var rates = opts.rates || { ".cam-bg": 0.45, ".cam-world": 1, ".cam-fg": 1.55 };
    var applied = [];

    Object.keys(rates).forEach(function (sel) {
      var els = document.querySelectorAll(sel);
      if (!els.length) return;
      tl.fromTo(
        els,
        { scale: 1, transformOrigin: origin },
        { scale: 1 + zoom * rates[sel], duration: dur, ease: ease },
        at,
      );
      applied.push(sel);
    });

    return applied;
  }

  /**
   * Real camera dolly using CSS 3D. Layers sit at different z; moving them all by the
   * same amount makes near layers grow more than far ones — which is what a camera does,
   * as opposed to `scale`, which grows everything equally and reads as "props inflating".
   *
   *   Stage.dolly(tl, { layers: [{ sel: "#s47-bg", z: -300 }, { sel: "#s47-stage", z: 0 }], move: 140 });
   */
  function dolly(tl, opts) {
    opts = opts || {};
    var rootEl = document.querySelector("#root");
    if (!rootEl) return false;
    var perspective = opts.perspective == null ? 1400 : opts.perspective;
    rootEl.style.perspective = perspective + "px";
    rootEl.style.perspectiveOrigin = opts.origin || "50% 62%";
    rootEl.style.transformStyle = "preserve-3d";

    var layers = opts.layers || [];
    var move = opts.move == null ? 120 : opts.move;
    var dur = opts.duration == null ? 3.6 : opts.duration;
    var at = opts.at == null ? 0 : opts.at;
    var applied = [];

    layers.forEach(function (layer) {
      var els = document.querySelectorAll(layer.sel);
      if (!els.length) return;
      var z0 = layer.z || 0;
      // pre-scale so the layer still fills the frame at its resting depth
      var comp = (perspective - z0) / perspective;
      for (var i = 0; i < els.length; i++) {
        els[i].style.transformStyle = "preserve-3d";
        els[i].style.backfaceVisibility = "hidden";
      }
      tl.fromTo(els, { z: z0, scale: comp }, { z: z0 + move, duration: dur, ease: "none" }, at);
      applied.push(layer.sel);
    });

    return applied;
  }

  /**
   * Gravity-correct fall. Starts at rest, accelerates down, fades near the end.
   * `y` is the drop distance in px; positive is down.
   */
  function fall(tl, target, opts) {
    opts = opts || {};
    var at = opts.at == null ? 0 : opts.at;
    var dur = opts.duration == null ? 0.7 : opts.duration;
    var drop = opts.drop == null ? 56 : opts.drop;
    var stagger = opts.stagger || 0;
    return tl.fromTo(
      target,
      { y: 0, opacity: 0 },
      { y: drop, opacity: 1, duration: dur, ease: "power2.in", stagger: stagger },
      at,
    );
  }

  window.Stage = { snap: snap, camera: camera, dolly: dolly, fall: fall, soleOf: soleOf };
})();
