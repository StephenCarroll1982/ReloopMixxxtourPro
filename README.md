# Reloop Mixtour Pro — Mixxx Controller Mapping

A Mixxx MIDI mapping for the [Reloop Mixtour Pro](https://www.reloop.com/reloop-mixtour-pro),
a 4-deck all-in-one DJ controller built for Algoriddim's djay Pro. This mapping
aims for as much feature parity with the official djay Pro experience as Mixxx's
engine can support, and documents clearly where it can't (see
[Unsupported / partial features](#unsupported--partial-features) below).

## Install

Copy `Reloop Mixtour Pro.midi.xml` and `MixtourPro.js` into your Mixxx
controllers folder:

- Linux: `~/.mixxx/controllers/`
- macOS: `~/Library/Containers/org.mixxx.mixxx/Data/Library/Application Support/Mixxx/controllers/`
- Windows: `%LOCALAPPDATA%\Mixxx\controllers\`

Then in Mixxx: **Preferences → Controllers → Reloop Mixtour Pro → Enable**.

## Features

- Full 4-deck transport, mixer (gain/EQ/filter/volume), and browser controls
- All 7 usable pad modes (Hot Cue, Bounce Loop, Pitch Cue, Instant FX, Auto Loop,
  Sampler, Saved Loops), each mapped to the closest native Mixxx equivalent
- SHIFT+pad clears a hotcue; hotcue LEDs colored by state
- MODE-held direct pad-mode select overlay, with matching LED indicators
- MODE/MODE+SHIFT overlay on PLAY/CUE/SYNC/LOOP — purple indicator while the
  overlay is active, with bright-flash feedback on the one-shot pitch/tempo
  triggers (MODE+PLAY/CUE = pitch nudge, MODE+SHIFT+PLAY/CUE = tempo nudge,
  press-and-hold to repeat)
- Shared FX section: dry/wet knob and PARAM‹›  (press-and-hold to repeat) drive
  all 4 effect units' macro parameter; MODE+PARAM‹› pages the effect chain
  preset for one deck at a time
- FX ON paddle per deck, toggling both routing and the first effect slot
- 7-segment VU meters per deck

## Unsupported / partial features

- **Neural Mix** (real-time stem isolation) has no Mixxx equivalent and is left
  unmapped rather than faked.
- **Pitch Cue** pad mode is a best-effort scripted approximation (hotcue jump +
  temporary pitch offset) — Mixxx has no native "trigger and revert pitched
  sample" control like djay Pro's Pitch Play.
- **Instant FX** pads only do something for as many effect slots as your Mixxx
  effect unit is actually configured with (typically 3, not 8).
- **Sampler** pads are global across all 4 decks (Mixxx has one shared sampler
  bank, not per-deck banks) — this matches how sampler banks work generally,
  not a bug.
- **Saved Loops** mode uses the same underlying control as Hot Cue mode (Mixxx
  hotcues can natively store a loop range), distinguished only by LED tint and
  by what you've pre-programmed at each cue.

See [MAPPING_NOTES.md](MAPPING_NOTES.md) for the full hardware reverse-engineering
notes — every address the manufacturer PDF got wrong or left ambiguous, how each
was resolved against the real hardware, and the debugging setup used to do it.

## Reference material

- `midimap_MIXTOURPRO.pdf` — the manufacturer's MIDI map and LED color-coding
  reference. Correct on the broad channel layout, wrong or ambiguous on several
  specific addresses — see MAPPING_NOTES.md for the corrections.
- `scratchpad.txt` — early notes on pad-mode assignments.

## Credits

- Original mapping by Stephen Carroll.
- Corrections and additional features developed
against the physical hardware by @sayak-brm
