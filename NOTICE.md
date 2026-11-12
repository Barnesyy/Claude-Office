# Notice

## What the MIT licence covers

The code in this repository and its pixel art (the default office, its
furniture and effects, the default worker, boss and Claude sprites, the
incident-mode art, and the Trading Floor props under
`public/sprites/trading/props/`) are released under the MIT licence in
[LICENSE](LICENSE).

## EA scenes art

- The backtest station, crash cart and tick-data cabinets reuse upstream's MIT
  sprites (`public/sprites/rooms/server-rack-1.webp`, `crash-cart.webp`, the
  `filing-open` / `filing-closed` cabinets). The lights, screens and plates are
  drawn over them in SVG/CSS.
- `public/sprites/trading/ea/*.png` (risk flag, compile ok/error, tick archive)
  are restyled from **Kenney Game Icons** (https://kenney.nl/assets/game-icons),
  CC0 1.0 (public domain), by `scripts/make-ea-icons.py`: recoloured, a 3 px
  navy outline and a drop shadow to match the office. Credit is not required by
  CC0; it is given anyway.
- No Dunder Mifflin or other third-party art is used.

## The Dunder Mifflin skin has been removed

Upstream (W17ant/Claude-Office) shipped a Dunder Mifflin fan-art skin that its
NOTICE.md excluded from the MIT grant: the character sprites under
`public/sprites/office/characters/`, the props and cats under
`public/sprites/office/`, the `-dm` room pictures under `public/rooms/`, their
previews under `docs/images/`, and the quoted lines from the show.

This fork (the EA Development fork) deletes all of that and replaces it with
the original **Trading Floor** theme (`/trading-floor`), so everything in this
repository is covered by the MIT licence. The files are still in upstream's git
history; this fork does not redistribute them on its `ea-dev` branch.

*The Office* and Dunder Mifflin are trademarks of their respective owners. This
project is not affiliated with, endorsed by or sponsored by them.
