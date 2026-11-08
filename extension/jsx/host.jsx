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
