# FontBuilder

A font editor panel for Adobe Illustrator. Pick an open-licence font, edit its letters in the
panel, see your edits live on text in your Illustrator document, and export the result as your
brand's own font.

## What it does

- **Starting font**: seven open-licence families come with FontBuilder (including Passion One), in every weight and width
  they have. You can also pick a TrueType font installed on your computer, or choose a `.ttf`
  file. Only fonts whose licence allows changes are offered (SIL Open Font License or Apache).
  Adobe Fonts and most bought fonts can't be changed.
- **Character grid**: every character in the font: lowercase, then capitals, then figures, then
  everything else. Click one to edit it.
- **Letter editor**, with Illustrator's keys:

  | Key | Does |
  | --- | --- |
  | V or A | Select and move points |
  | + (or hold Alt) | Add point: click the outline to add a point |
  | P | Pen: click in empty space to place corners of a new shape (click the first corner or press Enter to close it, Esc cancels); clicking the outline adds a point |
  | M, L | Rectangle, Ellipse: drag to draw (Shift: square or circle, Alt: from the centre) |
  | Cut out (tick box) | New shapes cut a hole where they overlap the letter |
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

- **Characters**: draw capitals only, lowercase only or both. In a capitals-only font, typing
  lowercase gives the capitals (and the other way round). **Basic** keeps A–Z, a–z, 0–9 and
  everyday punctuation and leaves accented letters and symbols out of the font.
- **Heights**: sliders for ascender, cap height, x-height and descender. Each one changes every
  letter at once, and the baseline stays put.
- **Spacing and shape**: set the left and right space and the width of a letter, or reshape it
  (narrower, wider, taller, slant). You can apply these to a whole group of letters at once, such
  as the lowercase, letters with tails, or a group you make.
- **Guided stages**: n o H O first, then the lowercase, the capitals, and figures and
  punctuation. Each stage lets you tick letters off as reviewed.
- **Preview on your artboard**, two ways:
  - **As a real font**: select text and click **Use on selected text**. FontBuilder saves your
    edits as a font with a new name ("Your Name Preview 3"), installs it for your user account
    and sets the text in it, so it stays live, editable text. Click **Update** after more edits;
    each update installs a new preview font and removes the older ones. If Illustrator doesn't
    pick up the first one, restart Illustrator once.
  - **As shapes (instant)**: **Preview selected text** hides the text and draws it in your
    edited font, redrawn after every edit. **Stop** shows your text again, unchanged.
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
