/*
 * FontBuilder: the part that runs inside Illustrator (ExtendScript, which is ES3: no let/const,
 * no arrow functions, no JSON). The panel calls these functions with plain object literals and
 * gets back a string: "ok:..." on success or "error:..." with a message to show.
 *
 * Artboard preview: text frames you pick are hidden while FontBuilder draws the same text in
 * your edited font as shapes in a group right above each one. Stopping the preview removes the
 * shapes and shows the text frames again. A text frame being previewed is tagged in its `note`.
 */

var FB_TAG = "fontbuilder-preview:";
var FB_GROUP = "FontBuilder preview ";

/** A string as a JSON string literal (ExtendScript has no JSON object). */
function fbStr(s) {
  return '"' + String(s).replace(/[\\"]/g, "\\$&").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/[\u0000-\u001f]/g, "") + '"';
}

function fbNum(v) {
  var r = Math.round(v * 1000) / 1000;
  return isFinite(r) ? String(r) : "0";
}

/** Every text frame in the document that FontBuilder is previewing. */
function fbTagged(doc) {
  var out = [];
  for (var i = 0; i < doc.textFrames.length; i++) {
    var tf = doc.textFrames[i];
    var n = "";
    try {
      n = tf.note || "";
    } catch (e) {}
    if (n.indexOf(FB_TAG) === 0) out.push(tf);
  }
  return out;
}

/** What the panel needs to set a text frame's text: its lines, size, start point, alignment. */
function fbFrameJson(tf) {
  var ca = tf.textRange.characterAttributes;
  var size = ca.size;
  var leading = ca.autoLeading ? size * 1.2 : ca.leading;
  var just = "left";
  try {
    var j = tf.textRange.paragraphAttributes.justification;
    if (j === Justification.CENTER) just = "center";
    else if (j === Justification.RIGHT) just = "right";
  } catch (e) {}
  var a = tf.anchor;
  return (
    '{"id":' + fbStr(tf.note.substr(FB_TAG.length)) +
    ',"text":' + fbStr(tf.contents) +
    ',"size":' + fbNum(size) +
    ',"leading":' + fbNum(leading) +
    ',"tracking":' + fbNum(ca.tracking || 0) +
    ',"x":' + fbNum(a[0]) + ',"y":' + fbNum(a[1]) +
    ',"just":' + fbStr(just) +
    ',"area":' + (tf.kind === TextType.POINTTEXT ? "false" : "true") +
    "}"
  );
}

/** Tags the selected text frames for previewing and returns every previewed frame. */
function fbPreviewAdd() {
  try {
    if (!app.documents.length) return "error:Open a document and select some text first.";
    var doc = app.activeDocument;
    var sel = doc.selection;
    var added = 0;
    if (sel && sel.length) {
      for (var i = 0; i < sel.length; i++) {
        var it = sel[i];
        if (it.typename !== "TextFrame") continue;
        var n = "";
        try {
          n = it.note || "";
        } catch (e1) {}
        if (n.indexOf(FB_TAG) !== 0) it.note = FB_TAG + new Date().getTime() + "-" + i;
        added++;
      }
    }
    if (!added && !fbTagged(doc).length) return "error:Select a text frame on your artboard first (with the Selection tool).";
    return fbPreviewList();
  } catch (e) {
    return "error:" + e.message;
  }
}

/** Every previewed text frame in the active document, as JSON. */
function fbPreviewList() {
  try {
    if (!app.documents.length) return 'ok:{"frames":[]}';
    var tagged = fbTagged(app.activeDocument);
    var parts = [];
    for (var i = 0; i < tagged.length; i++) parts.push(fbFrameJson(tagged[i]));
    return 'ok:{"frames":[' + parts.join(",") + "]}";
  } catch (e) {
    return "error:" + e.message;
  }
}

function fbFindGroup(doc, id) {
  for (var i = 0; i < doc.groupItems.length; i++) if (doc.groupItems[i].name === FB_GROUP + id) return doc.groupItems[i];
  return null;
}

/**
 * Draws the previewed text frames. `frames` is a list of { id, paths } where each path is a list
 * of [x, y, inX, inY, outX, outY] anchors in document coordinates. Hides each text frame and puts
 * its shapes in a group right above it, in the text's own fill colour.
 */
function fbPreviewDraw(frames) {
  try {
    if (!app.documents.length) return "ok:0";
    var doc = app.activeDocument;
    var tagged = fbTagged(doc);
    var drawn = 0;
    for (var f = 0; f < frames.length; f++) {
      var fr = frames[f];
      var tf = null;
      for (var t = 0; t < tagged.length; t++) if (tagged[t].note === FB_TAG + fr.id) tf = tagged[t];
      if (!tf) continue;
      var wasLocked = tf.layer.locked;
      tf.layer.locked = false;
      var g = fbFindGroup(doc, fr.id);
      if (!g) {
        g = tf.layer.groupItems.add();
        g.name = FB_GROUP + fr.id;
        g.move(tf, ElementPlacement.PLACEBEFORE);
      }
      while (g.pageItems.length) g.pageItems[0].remove();
      var color = tf.textRange.characterAttributes.fillColor;
      if (fr.paths.length) {
        var cp = g.compoundPathItems.add();
        for (var i = 0; i < fr.paths.length; i++) {
          var con = fr.paths[i];
          var anchors = [];
          for (var k = 0; k < con.length; k++) anchors.push([con[k][0], con[k][1]]);
          var p = cp.pathItems.add();
          p.setEntirePath(anchors);
          p.closed = true;
          for (var m = 0; m < con.length; m++) {
            var pt = p.pathPoints[m];
            pt.leftDirection = [con[m][2], con[m][3]];
            pt.rightDirection = [con[m][4], con[m][5]];
          }
          p.stroked = false;
          p.filled = true;
          p.fillColor = color;
          p.evenodd = false;
        }
      }
      tf.hidden = true;
      tf.layer.locked = wasLocked;
      drawn++;
    }
    return "ok:" + drawn;
  } catch (e) {
    return "error:" + e.message + (e.line ? " (host.jsx line " + e.line + ")" : "");
  }
}

/** Ends the preview: removes the drawn shapes and shows the text frames again, untouched. */
function fbPreviewStop() {
  try {
    if (!app.documents.length) return "ok:0";
    var doc = app.activeDocument;
    var tagged = fbTagged(doc);
    for (var i = 0; i < tagged.length; i++) {
      var tf = tagged[i];
      var id = tf.note.substr(FB_TAG.length);
      var wasLocked = tf.layer.locked;
      tf.layer.locked = false;
      var g = fbFindGroup(doc, id);
      if (g) g.remove();
      tf.hidden = false;
      tf.note = "";
      tf.layer.locked = wasLocked;
    }
    return "ok:" + tagged.length;
  } catch (e) {
    return "error:" + e.message;
  }
}
