# FontBuilder

A font editor that lives inside Adobe Illustrator. Pick an open-licence font, and FontBuilder lays
it out on a new canvas with one artboard per letter. You redraw the letters with Illustrator's own
tools, guided stage by stage, and (from step 2 of the build) export the result as a new font for
your brand.

## What works now (steps 1 and 2)

- **Choose a starting font**: six open-licence fonts come with FontBuilder, the panel finds TrueType
  fonts installed on your computer whose licence allows changes, or you can choose a `.ttf` file.
- **Licence check**: only fonts under the SIL Open Font License or Apache License can be used. The
  panel says why a font is blocked, and lists any Reserved Font Names your version can't use.
- **Create canvas**: a new document with one artboard per letter, in design order (key letters
  n o H O, then lowercase, capitals, figures and punctuation). Each artboard is as wide as the
  letter's spacing. Letters are editable compound paths on the **Letters** layer; guides for the
  ascender, cap height, x-height, baseline and descender are on the locked **Guides** layer.
  Curves are converted exactly, so letters look identical to the font.
- **Your letters**: jump to any letter's artboard from the panel.
- **Export your font**: give it a name and style, preview it, and save a `.ttf` with a licence file
  next to it. FontBuilder reads every filled shape on the Letters layer and assigns it to the
  artboard its middle sits on. The artboard's width is the letter's spacing, so resizing it with the
  Artboard tool changes the space around the letter. Shapes keep the fill Illustrator shows (holes
  in compound paths stay holes, overlapping shapes join), and curves are converted to the font's
  curves within one font unit. Letters not on the canvas, kerning and other features carry over
  from the original. The name is checked against the licence's Reserved Font Names, and the
  original copyright and licence are kept in the font.

Stroke-only shapes, live text and images aren't included; the panel lists any it skipped.

Coming next: the full stage guide with test words and progress (step 3), group changes and
spacing (step 4), signed installer (step 5).

## Install (Windows)

1. Download `FontBuilder.zip` and unzip it.
2. Double-click `install-windows.cmd`. It copies FontBuilder to
   `%APPDATA%\Adobe\CEP\extensions\FontBuilder` and lets Illustrator load panels that aren't from
   Adobe Exchange (it sets `PlayerDebugMode` for CEP 9 to 12). If Windows says it protected your
   PC, choose **More info**, then **Run anyway**.
3. Restart Illustrator and open **Window > Extensions > FontBuilder**.

On a Mac, run `install-mac.command` instead.

## Develop

```sh
npm install
npm test          # unit tests, including host.jsx against a stand-in for Illustrator
npm run build     # builds dist/FontBuilder plus the install scripts
```

- `extension/` is the CEP extension: `CSXS/manifest.xml`, the panel page, `jsx/host.jsx` (the
  ExtendScript that runs inside Illustrator, ES3 only) and the bundled fonts with their OFL texts.
- `src/font/` reads and writes TrueType fonts. `src/canvas/` turns a font into the canvas layout
  and converts TrueType curves into Illustrator's anchors and handles. `src/export/` goes the other
  way: Illustrator paths back into TrueType contours, then the finished font. `src/panel/` is the
  panel UI.
- With the extension installed, the panel can be inspected at http://localhost:8088 in Chrome
  (set in `extension/.debug`).

## Licences

The bundled fonts are under the SIL Open Font License 1.1; each folder in `extension/fonts/` keeps
its `OFL.txt`. Mona Sans reserves the name "Mona".
