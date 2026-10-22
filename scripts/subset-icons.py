"""Subset the Material Symbols Outlined variable font to the icons Atlas uses.

The full font is 3.9 MB for four glyphs. To add an icon, list its name here and
in the command below, regenerate, and commit src/assets/fonts/*.woff2.

  python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
  npm pack material-symbols@0.44.3 && tar xzf material-symbols-0.44.3.tgz
  /tmp/fontenv/bin/python scripts/subset-icons.py \\
      package/material-symbols-outlined.woff2 \\
      src/assets/fonts/material-symbols-subset.woff2 \\
      settings keep terminal progress_activity

The subsetter keeps the variable axes (FILL, wght, GRAD, opsz) and only the
ligatures for the named icons: pyftsubset --layout-features would keep every
ligature composable from the letters (670 KB). Icons: Apache-2.0, Google.
"""
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

src, dst, *names = sys.argv[1:]
font = TTFont(src)
cmap = font.getBestCmap()
order = font.getGlyphOrder()

# Ligature glyph for each icon name: the rlig lookup maps the letters of the
# name to one glyph.
wanted = {}
for name in names:
    seq = [cmap[ord(c)] for c in name]
    wanted[tuple(seq)] = None
gsub = font["GSUB"].table
keep_glyphs = set()
for lookup in gsub.LookupList.Lookup:
    for st in lookup.SubTable:
        st = getattr(st, "ExtSubTable", st)
        if not hasattr(st, "ligatures"):
            continue
        new = {}
        for first, ligs in st.ligatures.items():
            kept = []
            for lig in ligs:
                seq = (first, *lig.Component)
                if seq in wanted:
                    wanted[seq] = lig.LigGlyph
                    kept.append(lig)
                    keep_glyphs.add(lig.LigGlyph)
            if kept:
                new[first] = kept
        st.ligatures = new
missing = [seq for seq, g in wanted.items() if g is None]
if missing:
    sys.exit(f"no ligature found for {missing}")

opts = subset.Options()
opts.layout_features = ["rlig", "rclt", "liga"]
opts.flavor = "woff2"
opts.hinting = False
opts.desubroutinize = True
sub = subset.Subsetter(opts)
sub.populate(text="".join(sorted(set("".join(names)))), glyphs=sorted(keep_glyphs))
sub.subset(font)
font.flavor = "woff2"
font.save(dst)
print(dst, font.getGlyphOrder())
