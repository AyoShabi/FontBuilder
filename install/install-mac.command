#!/bin/sh
# Installs the FontBuilder panel for Illustrator on macOS (unsigned development install).
cd "$(dirname "$0")"
for v in 9 10 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/FontBuilder"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R FontBuilder "$DEST"
echo "FontBuilder is installed. Restart Illustrator, then open it from Window > Extensions > FontBuilder."
