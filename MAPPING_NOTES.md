# Reloop Mixtour Pro — Mixxx Mapping Notes

Findings from building and hardware-testing `Reloop Mixtour Pro.midi.xml` /
`MixtourPro.js`. The manufacturer PDF (`midimap_MIXTOURPRO.pdf`) got the broad
channel layout right but was wrong or ambiguous on several specific addresses —
those were only resolved by running Mixxx with `--controller-debug` against the
real, USB-connected hardware and reading the raw MIDI bytes. This doc exists so
the next round of changes doesn't have to re-discover any of this the hard way.

## Confirmed channel map (PDF was correct here)

| Category | CH index | Note status | CC status |
|---|---|---|---|
| Deck N Transport+Mixer (N=1-4) | `00-03` | `0x90-0x93` | `0xB0-0xB3` |
| Deck N Pads/Other (N=1-4) | `04-07` | `0x94-0x97` | `0xB4-0xB7` |
| Deck N FX Unit (N=1-4) | `08-0B` | `0x98-0x9B` | `0xB8-0xBB` |
| Global | `0F` | `0x9F` | `0xBF` |

## Where the PDF was wrong or ambiguous (hardware-corrected)

| Control | PDF suggested | Hardware actually sends | Fix |
|---|---|---|---|
| FX dry/wet knob | One knob per deck, E-channel | **One shared knob, global channel** — `0xBF` CC `0x02`, absolute 0-127 | Applies to all 4 `[EffectRack1_EffectUnitN] mix` at once |
| PARAM< / PARAM> (base) | Ambiguous column alignment | Global channel, notes `0x03`/`0x04` | Nudges `super1` (macro/depth) ±0.05 on all 4 units, not `next_chain`/`prev_chain` (that swaps the loaded effect, not its level) |
| MODE+PARAM< / MODE+PARAM> | Read as E-channel `0x0A`/`0x0D` | Actually E-channel `0x0B`/`0x0C` (per deck) | Pages `next_chain`/`prev_chain` for **that one deck's** unit only |
| FX ON paddle | `enabled` on `[EffectRack1_EffectUnitN]` | That control doesn't exist at the unit level | Real controls: `group_[ChannelN]_enable` (routing) **and** `[EffectRack1_EffectUnitN_Effect1] enabled` (the slot itself) — both must be set together |
| VU meter | `VuMeter`, continuous | Real Mixxx control is lowercase `vu_meter`; PDF's "00-06" range is a literal 7-segment discrete output, not a scaled continuous one | 7 threshold `<output>` blocks per deck (mirrors Mixxx's own bundled Reloop Jockey 3 ME mapping) |
| Browse encoder | Relative, `selectknob` | Raw relative delta passed straight through caused multi-row jumps per detent | JS-normalized to exactly ±1 row per detent |
| SHIFT+pad (hotcue clear) | Implied same note + modifier | **Completely different note**: `0x1C-0x23` instead of `0x14-0x1B` while SHIFT is held. Has its own separate LED bank too — writing to the base pad note has zero effect on the SHIFT-held display | Bind `0x1C-0x23` directly to clear; mirror pad color to both note ranges |
| Transport MODE/SHIFT+MODE overlay | Assumed same base note works, just recolor via a live "is MODE held" flag | **Wrong entirely** — see below, this needed its own investigation | Static LEDs, no live state needed (see next section) |

## The transport overlay LED discovery

This was the hardest one and worth documenting in full so it isn't re-litigated.

**Symptom chain:** tried recoloring the PLAY/CUE/SYNC/LOOP BiLEDs purple while a
per-deck "MODE held" JS flag was true (driven by note `0x08` on the pad channel).
Every attempt looked wrong — off when it should be lit, or lit when it shouldn't
be — even after independently confirming (via `amidi` sending raw test values
directly to the hardware) that the BiLED color table itself was correct:
`0x7D`=red, `0x7E`=blue, `0x7F`=purple, `0x01`/`0x02`/`0x03`=their dim equivalents.

**Root cause, proven by isolated test:** stopped Mixxx entirely, used `amidi -p
hw:4,0,0 -S "90 00 7D"` to set deck 1's PLAY LED to a static red with nothing
else running, then had the user hold the physical MODE button and report what
happened. **The LED went dark on its own** — proof the firmware autonomously
takes over the display during the MODE-held gesture, completely ignoring
whatever is sent to the base note (`0x00`) during that window. This is the
*exact same mechanism* already confirmed for the pads' SHIFT-variant LEDs
(`0x1C-0x23`) — the controller has a second, independent LED bank per button
that only becomes visible while a modifier is held, and the firmware — not
Mixxx — decides which bank to display.

Sent a static purple to note `0x28` next (PLAY's documented MODE-layer note from
the PDF's layered-note table) and it appeared correctly during the hold,
confirming the alternate address. **Because the firmware — not a live "is this
held" signal — decides which bank to show, none of this needs runtime state
tracking at all.** Set the overlay notes to a fixed color once at `init()` and
never touch them again; the per-deck `modeButton` input binding and its
`modeHeld` state were removed entirely as dead weight once this was understood.

**Full overlay note map** (base note pattern already confirmed correct by the
PDF; PLAY's MODE-layer note `0x28` hardware-confirmed directly, the other seven
follow the identical documented column pattern with high confidence):

| Button | Base | MODE layer | SHIFT+MODE layer |
|---|---|---|---|
| PLAY | `0x00` | `0x28` | `0x30` |
| CUE | `0x01` | `0x27` | `0x2F` |
| SYNC | `0x02` | `0x2B` | `0x2E` |
| LOOP (IN›OUT›EX) | `0x03` | `0x2A` | `0x2C` |

All 8 MODE/SHIFT+MODE notes (4 buttons × 2 layers), across all 4 decks, are set
to dim purple (`0x03`) once in `init()`. The four that also carry an input
action (PLAY/CUE at the MODE and SHIFT+MODE layers) flash to bright purple
(`0x7F`) on press and back to dim on release, layered on top via
`oneShotOverlay()` / `tempoNudgeOverlay()`. SYNC and LOOP's overlay notes have no
bound input (no requested behavior there) — they just sit at the static dim
purple baseline.

## MODE/SHIFT layer actions (PLAY & CUE only)

| Combo | Action | Behavior |
|---|---|---|
| MODE+PLAY | `pitch_up` | One-shot semitone jump, no repeat |
| MODE+CUE | `pitch_down` | One-shot semitone jump, no repeat |
| MODE+SHIFT+PLAY | `rate_perm_up` | Fires once, then debounce+auto-repeat while held |
| MODE+SHIFT+CUE | `rate_perm_down` | Fires once, then debounce+auto-repeat while held |

`rate_perm_*` (a permanent, one-step-at-a-time nudge) was used deliberately over
`rate_temp_*` (a momentary bend that snaps back on release) — the desired
behavior is a lasting tempo change, colloquially "pitch adjustment" to most DJs
even though it's really the rate/tempo control.

## Press-and-hold-to-repeat (shared pattern)

Two features use the same debounce-then-repeat timing, via
`engine.beginTimer`/`engine.stopTimer`:

- **Tempo nudge** (MODE+SHIFT+PLAY/CUE) — `rate_perm_up`/`rate_perm_down`
- **FX macro nudge** (PARAM< / PARAM>) — `super1` ±0.05 per step

Both: fire immediately on press → after `HOLD_REPEAT_DEBOUNCE_MS` (400ms) start
repeating every `HOLD_REPEAT_INTERVAL_MS` (100ms) → stop cleanly on release.
Deliberately **not** applied to MODE+PARAM<> (chain-preset paging) or the
semitone pitch jumps — rapid-firing through effect presets or jumping multiple
semitones per hold isn't desired behavior, only explicitly requested for the
tempo and macro-level nudges.

## Pad modes

| Pad mode | Mixxx control | Notes |
|---|---|---|
| Hot Cue | `hotcue_N_activate` / `_clear` (SHIFT+pad) | Unset pad = fully off. Set pad = full-power color from `HOTCUE_COLORS` |
| Bounce Loop | `beatlooproll_SIZE_activate` | Momentary, snaps back on release |
| Pitch Cue | `hotcue_N_activate` + temporary `pitch_adjust` | Best-effort scripted approximation of djay Pro's Pitch Play — Mixxx has no native trigger-and-revert pitched sample control |
| Instant FX | `[EffectRack1_EffectUnitD_EffectN] enabled`, momentary | Only as many pads as the deck's unit has configured effect slots (typically 3) do anything |
| Auto Loop | `beatloop_SIZE_activate` | Persistent, same size table as Bounce Loop |
| Sampler | `[SamplerN] cue_gotoandplay` | **Global in Mixxx, not per-deck** — Sampler-mode pads on any deck hit the same 8 slots. Intentional. |
| Saved Loops | Same as Hot Cue (`hotcue_N_activate`/`_clear`) | Mixxx hotcues natively store loop ranges, so this is the same engine control as Hot Cue — differs only in what the DJ pre-programmed. Shown with a dimmed tint (vs. Hot Cue's full power) so the two modes are still visually distinguishable. |
| Neural Mix | **Unmapped** | No Mixxx equivalent (real-time stem separation) |

`hotcue_N_enabled` is a **deprecated** Mixxx control name — use `hotcue_N_status`
(0 = empty, >0 = set/active) instead; the deprecated form still works but logs a
warning on every load.

## Development setup (for next time)

Mixxx is actually installed locally (`/usr/bin/mixxx`) and the physical
controller is USB-connected (`amidi -l` → `hw:4,0,0`, "Reloop Mixtour Pro MIDI
1"). This made hardware-in-the-loop debugging possible instead of guessing from
the PDF alone:

```bash
# Launch with full raw MIDI logging
/usr/bin/mixxx --controller-debug --controller-abort-on-warning --developer \
  --log-level debug --settings-path /home/sayakbrm/.mixxx/ > mixxx_debug.log 2>&1 &

# grep the log for "incoming:" / "outgoing:" lines to see exact bytes

# Send raw test MIDI straight to the hardware, bypassing Mixxx entirely -
# essential for isolating whether a behavior is firmware-level or Mixxx-level
amidi -p hw:4,0,0 -S "90 00 7D"   # e.g. set deck1 PLAY LED to a static test color
```

The `--controller-debug` log's `incoming:`/`outgoing:` lines, correlated by
timestamp, are what actually resolved the FX dry/wet channel, the MODE+PARAM<>
note numbers, and the SHIFT+pad note range — reasoning from the PDF alone got
those wrong on the first pass every time. When in doubt, capture, don't guess.
