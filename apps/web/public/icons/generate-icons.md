# Icon generation

Place 192x192 and 512x512 PNG icons here:
- icon-192.png
- icon-512.png

These should use the Supernote purple (#7c3aed) brand color with the "S" logo.

To generate with ImageMagick:
```
convert -size 192x192 xc:#7c3aed -fill white -font Helvetica-Bold -pointsize 80 \
  -gravity center -annotate 0 "S" icon-192.png
convert -size 512x512 xc:#7c3aed -fill white -font Helvetica-Bold -pointsize 200 \
  -gravity center -annotate 0 "S" icon-512.png
```
