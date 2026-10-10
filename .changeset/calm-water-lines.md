---
'vestigian': patch
---

The map opens on the standard OpenStreetMap sheet in light mode. Fixes long blue wedges of water across land on production (seen around Frauenfeld near the Bodensee, from zoom 9 to about 12): the Protomaps water layer also holds river centrelines, which the water fill closed into polygons. Both map views now fill polygons only, and the Standard view draws the real river and stream network and labels each river once.
