/*
 * FontBuilder: the part that runs inside Illustrator (ExtendScript, which is ES3: no let/const,
 * no arrow functions, no JSON). The panel calls these functions with plain object literals and
 * gets back a string: "ok:..." on success or "error:..." with a message to show.
 */

var FB_LETTERS = "Letters";
var FB_GUIDES = "Guides";
var FB_DATA = "FontBuilder data";

function fbGray(v) {
  var c = new RGBColor();
  c.red = v;
  c.green = v;
  c.blue = v;
  return c;
}

function fbAccent() {
  var c = new RGBColor();
  c.red = 0;
  c.green = 150;
  c.blue = 220;
  return c;
}

/** Shifts a [l, t, r, b] rect by dx, dy. */
function fbShift(r, dx, dy) {
  return [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy];
}

function fbAddLetter(layer, cell, dx, dy, black) {
  var cp = layer.compoundPathItems.add();
  cp.name = cell.name;
  for (var i = 0; i < cell.contours.length; i++) {
    var con = cell.contours[i];
    var anchors = [];
    for (var j = 0; j < con.length; j++) anchors.push([con[j].x + dx, con[j].y + dy]);
    var p = cp.pathItems.add();
    p.setEntirePath(anchors);
    p.closed = true;
    for (var k = 0; k < con.length; k++) {
      var pt = p.pathPoints[k];
      var a = con[k];
      pt.leftDirection = [a.ix + dx, a.iy + dy];
      pt.rightDirection = [a.ox + dx, a.oy + dy];
      pt.pointType = a.smooth ? PointType.SMOOTH : PointType.CORNER;
    }
    p.stroked = false;
    p.filled = true;
    p.fillColor = black;
    p.evenodd = false;
  }
  return cp;
}

/**
 * Creates a new document laid out by the panel: one artboard per letter, letters as editable
 * compound paths on the Letters layer, metric guides and labels on a locked Guides layer, and the
 * project data (source font, scale) on a hidden locked layer.
 */
function fbBuildCanvas(spec) {
  try {
    var first = spec.cells[0];
    if (!first) return "error:The font has none of the letters FontBuilder works with.";
    var w0 = first.rect[2] - first.rect[0];
    var h0 = first.rect[1] - first.rect[3];
    var doc = app.documents.add(DocumentColorSpace.RGB, w0, h0);

    // Centre the layout on the canvas: put the middle of the layout where the first artboard's middle is.
    var ab0 = doc.artboards[0].artboardRect;
    var b = spec.bounds;
    var dx = (ab0[0] + ab0[2]) / 2 - (b[0] + b[2]) / 2;
    var dy = (ab0[1] + ab0[3]) / 2 - (b[1] + b[3]) / 2;

    var letters = doc.layers[0];
    letters.name = FB_LETTERS;
    var guides = doc.layers.add();
    guides.name = FB_GUIDES;
    guides.move(letters, ElementPlacement.PLACEAFTER);
    var data = doc.layers.add();
    data.name = FB_DATA;
    data.move(guides, ElementPlacement.PLACEAFTER);

    var black = fbGray(0);
    var gray = fbGray(140);
    var accent = fbAccent();

    for (var i = 0; i < spec.cells.length; i++) {
      var cell = spec.cells[i];
      var rect = fbShift(cell.rect, dx, dy);
      var ab = i === 0 ? doc.artboards[0] : doc.artboards.add(rect);
      ab.artboardRect = rect;
      ab.name = cell.name;
      fbAddLetter(letters, cell, dx, dy, black);
    }

    for (var g = 0; g < spec.guides.length; g++) {
      var gl = spec.guides[g];
      var line = guides.pathItems.add();
      line.setEntirePath([
        [gl.x1 + dx, gl.y + dy],
        [gl.x2 + dx, gl.y + dy]
      ]);
      line.guides = true;
    }

    for (var t = 0; t < spec.labels.length; t++) {
      var lb = spec.labels[t];
      var tf = guides.textFrames.add();
      tf.contents = lb.text;
      tf.textRange.characterAttributes.size = lb.size;
      tf.textRange.characterAttributes.fillColor = lb.size > 20 ? accent : gray;
      tf.position = [lb.x + dx, lb.y + dy];
    }

    var note = data.textFrames.add();
    note.name = "fontbuilder-meta";
    note.contents = spec.metaJson;
    note.position = [b[0] + dx, b[3] + dy - 200];

    guides.locked = true;
    data.locked = true;
    data.visible = false;

    doc.artboards.setActiveArtboardIndex(0);
    try {
      app.executeMenuCommand("fitin");
    } catch (e1) {}
    return "ok:" + spec.cells.length;
  } catch (e) {
    return "error:" + e.message + (e.line ? " (host.jsx line " + e.line + ")" : "");
  }
}

/** Finds the active document's artboard for a letter and zooms to it. */
function fbGoTo(name) {
  try {
    if (!app.documents.length) return "error:Open your FontBuilder canvas first.";
    var doc = app.activeDocument;
    for (var i = 0; i < doc.artboards.length; i++) {
      if (doc.artboards[i].name === name) {
        doc.artboards.setActiveArtboardIndex(i);
        try {
          app.executeMenuCommand("fitin");
        } catch (e1) {}
        return "ok:" + i;
      }
    }
    return "error:This document has no artboard called " + name + ".";
  } catch (e) {
    return "error:" + e.message;
  }
}

/** Returns the project data saved in the active document, or "none" if it isn't a FontBuilder canvas. */
function fbReadMeta() {
  try {
    if (!app.documents.length) return "none";
    var doc = app.activeDocument;
    var layer;
    try {
      layer = doc.layers.getByName(FB_DATA);
    } catch (e1) {
      return "none";
    }
    for (var i = 0; i < layer.textFrames.length; i++) {
      if (layer.textFrames[i].name === "fontbuilder-meta") return "ok:" + layer.textFrames[i].contents;
    }
    return "none";
  } catch (e) {
    return "error:" + e.message;
  }
}

/** A string as a JSON string literal (ExtendScript has no JSON object). */
function fbStr(s) {
  return '"' + String(s).replace(/[\\"]/g, "\\$&").replace(/[\u0000-\u001f]/g, "") + '"';
}

/** Rounds to 1/1000 of a point and prints a number JSON accepts. */
function fbNum(v) {
  var r = Math.round(v * 1000) / 1000;
  return isFinite(r) ? String(r) : "0";
}

/**
 * Collects the shapes under an item: a path on its own, or a compound path's paths together
 * (so its holes stay holes), and everything inside groups. Notes things that won't be in the font.
 */
function fbCollect(item, out, notes) {
  if (item.hidden) return;
  var t = item.typename;
  if (t === "PathItem") {
    if (item.guides || item.clipping) return;
    if (!item.filled && item.stroked) {
      notes.push("stroke");
      return;
    }
    if (item.pathPoints.length >= 2) out.push({ item: item, paths: [item], eo: !!item.evenodd });
  } else if (t === "CompoundPathItem") {
    var ps = [];
    for (var i = 0; i < item.pathItems.length; i++) {
      var p = item.pathItems[i];
      if (p.pathPoints.length >= 2 && !p.guides) ps.push(p);
    }
    if (ps.length) out.push({ item: item, paths: ps, eo: !!ps[0].evenodd });
  } else if (t === "GroupItem") {
    for (var g = 0; g < item.pageItems.length; g++) fbCollect(item.pageItems[g], out, notes);
  } else if (t === "TextFrame") {
    notes.push("text");
  } else {
    notes.push("other");
  }
}

function fbPathJson(path, ox, oy) {
  var pts = path.pathPoints;
  var arr = [];
  for (var m = 0; m < pts.length; m++) {
    var pt = pts[m];
    arr.push(
      "[" +
        fbNum(pt.anchor[0] - ox) + "," + fbNum(pt.anchor[1] - oy) + "," +
        fbNum(pt.leftDirection[0] - ox) + "," + fbNum(pt.leftDirection[1] - oy) + "," +
        fbNum(pt.rightDirection[0] - ox) + "," + fbNum(pt.rightDirection[1] - oy) +
        "]"
    );
  }
  return "[" + arr.join(",") + "]";
}

/**
 * Reads every letter off the active FontBuilder canvas. Each shape on the Letters layer belongs
 * to the artboard its middle sits on. Coordinates come back relative to the
 * letter's origin: the artboard's left edge, `above` points below the artboard's top (the baseline).
 */
function fbReadLetters(above) {
  try {
    if (!app.documents.length) return "error:Open your FontBuilder canvas first.";
    var doc = app.activeDocument;
    var layer;
    try {
      layer = doc.layers.getByName(FB_LETTERS);
    } catch (e1) {
      return "error:This document has no Letters layer. Open the canvas FontBuilder made.";
    }
    var shapes = [];
    var notes = [];
    for (var i = 0; i < layer.pageItems.length; i++) fbCollect(layer.pageItems[i], shapes, notes);

    var abs = [];
    for (var a = 0; a < doc.artboards.length; a++) abs.push({ name: doc.artboards[a].name, r: doc.artboards[a].artboardRect, shapes: [] });

    var outside = 0;
    for (var p = 0; p < shapes.length; p++) {
      var b = shapes[p].item.geometricBounds; // [left, top, right, bottom]
      var cx = (b[0] + b[2]) / 2;
      var cy = (b[1] + b[3]) / 2;
      var home = null;
      for (var k = 0; k < abs.length; k++) {
        var r = abs[k].r;
        if (cx >= r[0] && cx <= r[2] && cy <= r[1] && cy >= r[3]) {
          home = abs[k];
          break;
        }
      }
      if (home) home.shapes.push(shapes[p]);
      else outside++;
    }

    var parts = [];
    for (var n = 0; n < abs.length; n++) {
      var ab = abs[n];
      var ox = ab.r[0];
      var oy = ab.r[1] - above;
      var sj = [];
      for (var q = 0; q < ab.shapes.length; q++) {
        var sh = ab.shapes[q];
        var pj = [];
        for (var w = 0; w < sh.paths.length; w++) pj.push(fbPathJson(sh.paths[w], ox, oy));
        sj.push('{"evenodd":' + (sh.eo ? "true" : "false") + ',"paths":[' + pj.join(",") + "]}");
      }
      parts.push('{"name":' + fbStr(ab.name) + ',"width":' + fbNum(ab.r[2] - ab.r[0]) + ',"shapes":[' + sj.join(",") + "]}");
    }
    var noteList = [];
    for (var z = 0; z < notes.length; z++) noteList.push(fbStr(notes[z]));
    return 'ok:{"letters":[' + parts.join(",") + '],"notes":[' + noteList.join(",") + '],"outside":' + outside + "}";
  } catch (e) {
    return "error:" + e.message + (e.line ? " (host.jsx line " + e.line + ")" : "");
  }
}
