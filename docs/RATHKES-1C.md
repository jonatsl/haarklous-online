# Rathkes gate 1C – preparation for the second flat (issue #44)

The user's wish (2 Nov 2026): add another apartment like Haarklous plass 17A – Rathkes gate 1C, 5th floor, entered through the
backyard (bakgården). The user sends photos of the backyard and the flat later; until then the way in is prepared.

## What is in the game now (`game-rathkes.js`)
- The building is OpenStreetMap way 113875904 (in the Gamle Oslo patch, 18.2 m high): the corner block between Rathkes gate and
  Schous plass. Address nodes: 1A (local −837.1, 1788.2), 1B (−842.3, 1797.2), 1C (−838.5, 1804.3). 1A sits behind the street
  façade (the gate passage); 1B and 1C open onto the backyard, which matches "entrance through the bakgård".
- **The gate:** on Google Street View (checked 3 Nov 2026) the way in is a wrought-iron gate under a blue "1" at the east end of the
  façade on Rathkes gate, next to the newer pink building (Rathkes gate 3, with the garage door). In the game: a two-leaf iron gate
  (□ opens both leaves; shared online like other doors) with the "1" and a street sign.
- **The passage:** a 2.9 m wide, 3.6 m high passage from the gate straight through the building to the backyard (13 m). The
  building is split into its two parts either side of the passage (`GameRathkes.split`, Node-tested); the storeys over the
  passage are drawn on top.
- **The backyard:** between the block's inner walls and the neighbours; the doors 1B (locked, "someone lives here") and 1C (sign
  "5. etg · kommer", □ says the flat comes when the photos arrive).

## What Street View shows of the façade (for the later model)
- Ground floor: grey plaster, the iron gate, a hairdresser ("FRISØR") further west.
- Upper floors: grey plaster with yellow brick pilasters between the windows, carved cartouches over the 2nd-floor windows,
  white two-pane windows. The game still draws the block with the patch's red-brick facade.

## Still to do when the photos arrive
1. **Backyard photos:** the ground (asphalt, cobbles, grass?), bike racks, bins, trees, the exact place of the 1C door, any steps.
2. **Stairwell 1C:** photos of each landing (stairs turn left or right?), the door to the flat on the 5th floor, the light.
3. **The flat:** a floor plan or photos of every room (like `apartment-data.js` for 17A: walls, doors, windows, kitchen, bath,
   furniture). Measurements help (room lengths, ceiling height).
4. **Façade:** a straight photo of the street front and of the backyard front, to replace the red brick.

How it will be built: the stair tower from `stairwell.js` (as in the eight enterable neighbours) behind door 1C up to the 5th
floor (about 13 m above the yard: ground floor ~3.6 m, then ~3.1 m per floor), and a second apartment model in its own data file,
placed in the block's backyard wing. 17A stays the home; 1C becomes a second place you can go.
