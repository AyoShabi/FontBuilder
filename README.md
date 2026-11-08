# FontBuilder

A font editor panel for Adobe Illustrator. Pick an open-licence font, edit its letters in the
panel, see your edits live on text in your Illustrator document, and export the result as your
brand's own font.

## What it does

- **Starting font**: six open-licence families come with FontBuilder, in every weight and width
  they have. You can also pick a TrueType font installed on your computer, or choose a `.ttf`
  file. Only fonts whose licence allows changes are offered (SIL Open Font License or Apache).
  Adobe Fonts and most bought fonts can't be changed.
- **Character grid**: every character in the font: lowercase, then capitals, then figures, then
  everything else. Click one to edit it.
- **Letter editor**, with Illustrator's keys:

  | Key | Does |
  | --- | --- |
  | V or A | Select and move points |
  | P or + (or hold Alt) | Add a point on the outline |
  | − | Delete the point you click |
  | Shift+C (or C) | Curve: drag a straight line to bend it |
  | Shift while dragging | Keep the move horizontal, vertical or at 45° |
  | Shift-click | Add a point to the selection, or take it out |
  | Space-drag, middle-drag, scroll | Move the view |
  | Alt+scroll, Ctrl+scroll, Ctrl + / Ctrl − | Zoom in and out |
  | Ctrl+0 | Fit the letter |
  | Ctrl+Y | Filled preview on or off |
  | Arrows (Shift: ×10) | Nudge the selected points |
  | Delete | Delete the selected points (a curve handle straightens that part) |
  | Ctrl+A, Ctrl+Shift+A, Esc | Select all, deselect |
  | Ctrl+Z, Ctrl+Shift+Z | Undo, redo |

- **Heights**: sliders for ascender, cap height, x-height and descender. Each one changes every
  letter at once, and the baseline stays put.
- **Spacing and shape**: set the left and right space and the width of a letter, or reshape it
  (narrower, wider, taller, slant). You can apply these to a whole group of letters at once, such
  as the lowercase, letters with tails, or a group you make.
- **Guided stages**: n o H O first, then the lowercase, the capitals, and figures and
  punctuation. Each stage lets you tick letters off as reviewed.
- **Preview on your artboard**: select text in your Illustrator document and click **Preview
  selected text**. FontBuilder hides that text and draws it in your edited font in the same
  place, size and colour. It redraws after every edit. **Stop preview** removes the drawing and
  shows your text again, unchanged.
- **Export**: saves a `.ttf` with your font's name and style, and a licence file next to it. The
  name is checked against the licence's Reserved Font Names. The original copyright and licence
  stay in the font. Kerning and other features carry over.
- **Projects**: your work is saved in the panel automatically. **Project > Save project** and
  **Open project** move it between computers.

## Install (Windows)

1. Download `FontBuilder.zip` and unzip it.
2. Double-click `install-windows.cmd`. If Windows says it protected your PC, choose **More info**,
   then **Run anyway**.
3. Restart Illustrator and open **Window > Extensions > FontBuilder**.

On a Mac, run `install-mac.command` instead.

## Develop

```sh
npm install
npm test          # unit tests, including host.jsx against a stand-in for Illustrator
npm run build     # builds dist/FontBuilder plus the install scripts
```

- `extension/`: the CEP extension. It holds `CSXS/manifest.xml`, the panel page and styles,
  `jsx/host.jsx` (the ExtendScript that runs inside Illustrator, ES3 only, used for the artboard
  preview), and the bundled fonts with their OFL texts.
- `src/font/`: reads and writes TrueType fonts.
- `src/editor/`: the edit model. Point offsets, added and removed points, heights, groups and
  stages all live here.
- `src/ui/`: the panel's views.
- `src/panel/`: the bridge to Illustrator. It covers files, installed fonts, the keyboard, and the
  artboard preview.
- With the extension installed, you can inspect the panel at http://localhost:8088 in Chrome.

The editor started as the Type Workshop web app (AyoShabi/type-workshop).

## Licences

The bundled fonts are under the SIL Open Font License 1.1. Each folder in `extension/fonts/` keeps
its `OFL.txt`. Mona Sans reserves the name "Mona".
