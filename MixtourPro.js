var MixtourPro = {};

// Per-deck status bytes for each category channel, matching the mapping XML.
MixtourPro.TRANSPORT_STATUS = [0x90, 0x91, 0x92, 0x93];
MixtourPro.PAD_STATUS = [0x94, 0x95, 0x96, 0x97];
MixtourPro.PAD_BASE = 0x14; // pads 1-8 -> notes 0x14-0x1B
MixtourPro.PAD_SHIFT_BASE = 0x1C; // SHIFT+pad 1-8 -> notes 0x1C-0x23 (hardware-encoded, confirmed by capture)

// Transport BiLED colors (2-bit R/B, page 2 of midimap_MIXTOURPRO.pdf): dimmed = off
// state, full = on state. Blue for decks 1/2, red for decks 3/4, on the base transport
// notes. Purple is reserved for the MODE/SHIFT+MODE overlay notes (see below).
MixtourPro.TRANSPORT_BLUE = { dim: 0x02, full: 0x7E };
MixtourPro.TRANSPORT_RED = { dim: 0x01, full: 0x7D };
MixtourPro.TRANSPORT_PURPLE = { dim: 0x03, full: 0x7F };

MixtourPro.MODE_HOTCUE = 0;
MixtourPro.MODE_BOUNCE_LOOP = 1;
MixtourPro.MODE_PITCH_CUE = 2;
MixtourPro.MODE_INSTANT_FX = 3;
MixtourPro.MODE_AUTO_LOOP = 4;
MixtourPro.MODE_SAMPLER = 5;
MixtourPro.MODE_SAVED_LOOPS = 6;
// 7 = Neural Mix: no Mixxx equivalent (stem separation), intentionally unmapped.

MixtourPro.ROLL_SIZES = ["0.0625", "0.125", "0.25", "0.5", "1", "2", "4", "8"];
MixtourPro.LOOP_SIZES = ["0.25", "0.5", "1", "2", "4", "8", "16", "32"];
MixtourPro.PITCH_CUE_SEMITONES = [-4, -3, -2, -1, 1, 2, 3, 4];

// RGB pad color-binary values from the controller's LED color-coding map (page 2 of
// midimap_MIXTOURPRO.pdf): low 6 bits pick a color, bit 6 selects dimmed (unset) vs
// full (25% vs 100%) power.
MixtourPro.HOTCUE_COLORS = [0x03, 0x0C, 0x30, 0x3F, 0x3C, 0x06, 0x09, 0x12];
MixtourPro.PAD_OFF = 0x00;

// Flat color shown across all 8 pads for modes that aren't per-pad-colored.
MixtourPro.MODE_FLAT_COLOR = {
    1: 0x0C, // Bounce Loop - green
    2: 0x03, // Pitch Cue - blue
    3: 0x30, // Instant FX - red
    4: 0x0C, // Auto Loop - green
    5: 0x3F, // Sampler - white
    6: 0x03  // Saved Loops - blue
};

MixtourPro.state = {};

MixtourPro.deckFromStatus = function(status) {
    var nibble = status & 0x0F;
    if (nibble <= 3) {
        return nibble + 1; // transport channel 0x90-0x93
    }
    if (nibble <= 7) {
        return nibble - 3; // pad channel 0x94-0x97
    }
    return nibble - 7; // FX unit channel 0x98-0x9B
};

MixtourPro.init = function() {
    for (var d = 1; d <= 4; d++) {
        MixtourPro.state[d] = { padMode: MixtourPro.MODE_HOTCUE, loopStage: 0 };

        for (var i = 1; i <= 8; i++) {
            engine.makeConnection("[Channel" + d + "]", "hotcue_" + i + "_status",
                (function(deck) {
                    return function() { MixtourPro.updatePadLEDs(deck); };
                })(d));
        }

        ["play", "cue_indicator", "sync_enabled", "loop_enabled"].forEach(function(key) {
            engine.makeConnection("[Channel" + d + "]", key,
                (function(deck) {
                    return function() { MixtourPro.updateTransportLEDs(deck); };
                })(d));
        });

        MixtourPro.updateModeLEDs(d);
        MixtourPro.updatePadLEDs(d);
        MixtourPro.updateTransportLEDs(d);

        var transportStatus = MixtourPro.TRANSPORT_STATUS[d - 1];
        [MixtourPro.MODE_OVERLAY_NOTES, MixtourPro.SHIFT_MODE_OVERLAY_NOTES].forEach(function(notes) {
            Object.keys(notes).forEach(function(key) {
                midi.sendShortMsg(transportStatus, notes[key], MixtourPro.TRANSPORT_PURPLE.dim);
            });
        });
    }
    print("Reloop Mixtour Pro mapping loaded");
};

MixtourPro.shutdown = function() {
    for (var d = 1; d <= 4; d++) {
        var status = MixtourPro.PAD_STATUS[d - 1];
        for (var m = 0; m <= 6; m++) {
            midi.sendShortMsg(status, m, 0x00);
        }
        for (var i = 0; i < 8; i++) {
            midi.sendShortMsg(status, MixtourPro.PAD_BASE + i, 0x00);
        }
    }
};

// The controller has SEPARATE LED addresses for PLAY/CUE/SYNC/LOOP that are only
// displayed while the MODE (and MODE+SHIFT) overlay is physically held (confirmed by
// hardware test: writing to the base PLAY note, 0x00, has zero visible effect during
// the hold - the firmware shows note 0x28 instead; same pattern already confirmed for
// pads' SHIFT-variant LEDs). These are static - the firmware picks which bank to
// display based on the physical hold state, so we just set them once at init and
// never touch them again, except for the pitch/tempo notes below which flash bright
// on press.
MixtourPro.MODE_OVERLAY_NOTES = { play: 0x28, cue: 0x27, sync: 0x2B, loop: 0x2A };
MixtourPro.SHIFT_MODE_OVERLAY_NOTES = { play: 0x30, cue: 0x2F, sync: 0x2E, loop: 0x2C };

MixtourPro.transportColor = function(deck) {
    return (deck === 1 || deck === 2) ? MixtourPro.TRANSPORT_BLUE : MixtourPro.TRANSPORT_RED;
};

MixtourPro.updateTransportLEDs = function(deck) {
    var status = MixtourPro.TRANSPORT_STATUS[deck - 1];
    var ch = "[Channel" + deck + "]";
    var color = MixtourPro.transportColor(deck);

    midi.sendShortMsg(status, 0x00, engine.getValue(ch, "play") > 0 ? color.full : color.dim);
    midi.sendShortMsg(status, 0x01, engine.getValue(ch, "cue_indicator") > 0 ? color.full : color.dim);
    midi.sendShortMsg(status, 0x02, engine.getValue(ch, "sync_enabled") > 0 ? color.full : color.dim);
    midi.sendShortMsg(status, 0x03, engine.getValue(ch, "loop_enabled") > 0 ? color.full : color.dim);
};

// MODE/MODE+SHIFT one-shot pitch/tempo triggers (PLAY/CUE overlay notes): flash the
// pressed note bright purple, back to dim purple on release.
MixtourPro.oneShotOverlay = function(key) {
    return function(channel, control, value, status, group) {
        var deck = MixtourPro.deckFromStatus(status);
        var transportStatus = MixtourPro.TRANSPORT_STATUS[deck - 1];
        if (value > 0) {
            midi.sendShortMsg(transportStatus, control, MixtourPro.TRANSPORT_PURPLE.full);
            engine.setValue("[Channel" + deck + "]", key, 1);
        } else {
            midi.sendShortMsg(transportStatus, control, MixtourPro.TRANSPORT_PURPLE.dim);
        }
    };
};

MixtourPro.pitchUpOverlay = MixtourPro.oneShotOverlay("pitch_up");
MixtourPro.pitchDownOverlay = MixtourPro.oneShotOverlay("pitch_down");

// Shared press-and-hold-to-repeat timing: fires once immediately, then after an
// initial debounce delay keeps auto-repeating at a faster interval for as long as
// the control is held. Used by the tempo nudge and FX macro nudge below.
MixtourPro.HOLD_REPEAT_DEBOUNCE_MS = 400;
MixtourPro.HOLD_REPEAT_INTERVAL_MS = 100;

// Tempo nudge (MODE+SHIFT+PLAY/CUE) - unlike the semitone pitch jumps above, which
// stay strictly one-shot, this auto-repeats while held.
MixtourPro.tempoNudgeTimers = {};

MixtourPro.tempoNudgeOverlay = function(key) {
    return function(channel, control, value, status, group) {
        var deck = MixtourPro.deckFromStatus(status);
        var transportStatus = MixtourPro.TRANSPORT_STATUS[deck - 1];
        var timerKey = deck + "-" + key;
        var ch = "[Channel" + deck + "]";

        if (value > 0) {
            midi.sendShortMsg(transportStatus, control, MixtourPro.TRANSPORT_PURPLE.full);
            engine.setValue(ch, key, 1);

            MixtourPro.tempoNudgeTimers[timerKey] = engine.beginTimer(MixtourPro.HOLD_REPEAT_DEBOUNCE_MS, function() {
                MixtourPro.tempoNudgeTimers[timerKey] = engine.beginTimer(MixtourPro.HOLD_REPEAT_INTERVAL_MS, function() {
                    engine.setValue(ch, key, 1);
                }, false);
            }, true);
        } else {
            midi.sendShortMsg(transportStatus, control, MixtourPro.TRANSPORT_PURPLE.dim);
            var timerId = MixtourPro.tempoNudgeTimers[timerKey];
            if (timerId) {
                engine.stopTimer(timerId);
                delete MixtourPro.tempoNudgeTimers[timerKey];
            }
        }
    };
};

MixtourPro.tempoNudgeUpOverlay = MixtourPro.tempoNudgeOverlay("rate_perm_up");
MixtourPro.tempoNudgeDownOverlay = MixtourPro.tempoNudgeOverlay("rate_perm_down");

// -- Pad-mode select: notes 0x00-0x06 on each deck's P-channel. Direct/stateless -
// the controller firmware (not this script) is what decides when these notes get
// sent, per the MODE-held direct-select gesture documented in the PDF.
MixtourPro.selectMode = function(channel, control, value, status, group) {
    if (value === 0) {
        return;
    }
    var deck = MixtourPro.deckFromStatus(status);
    MixtourPro.state[deck].padMode = control;
    MixtourPro.updateModeLEDs(deck);
    MixtourPro.updatePadLEDs(deck);
};

MixtourPro.updateModeLEDs = function(deck) {
    var status = MixtourPro.PAD_STATUS[deck - 1];
    var active = MixtourPro.state[deck].padMode;
    for (var m = 0; m <= 6; m++) {
        midi.sendShortMsg(status, m, m === active ? 0x7F : 0x00);
    }
};

MixtourPro.updatePadLEDs = function(deck) {
    var status = MixtourPro.PAD_STATUS[deck - 1];
    var mode = MixtourPro.state[deck].padMode;
    var ch = "[Channel" + deck + "]";

    for (var i = 0; i < 8; i++) {
        var note = MixtourPro.PAD_BASE + i;
        var value;

        if (mode === MixtourPro.MODE_HOTCUE || mode === MixtourPro.MODE_SAVED_LOOPS) {
            var isSet = engine.getValue(ch, "hotcue_" + (i + 1) + "_status"); // 0 = empty, >0 = set/active
            if (!isSet) {
                value = MixtourPro.PAD_OFF;
            } else if (mode === MixtourPro.MODE_SAVED_LOOPS) {
                value = MixtourPro.HOTCUE_COLORS[i]; // dimmed tint - visually distinct from Hot Cue
            } else {
                value = MixtourPro.HOTCUE_COLORS[i] | 0x40; // full power for Hot Cue mode
            }
        } else if (MixtourPro.MODE_FLAT_COLOR.hasOwnProperty(mode)) {
            value = MixtourPro.MODE_FLAT_COLOR[mode];
        } else {
            value = MixtourPro.PAD_OFF; // Neural Mix (unmapped) or unknown mode
        }

        midi.sendShortMsg(status, note, value);
        // The controller shows a separate LED bank for the SHIFT+pad notes
        // (0x1C-0x23) - mirror the same color there so pads don't go dark on SHIFT.
        midi.sendShortMsg(status, MixtourPro.PAD_SHIFT_BASE + i, value);
    }
};

// -- Pad press dispatcher: what a physical pad does depends on the deck's current mode.
MixtourPro.padPress = function(channel, control, value, status, group) {
    var deck = MixtourPro.deckFromStatus(status);
    var index = control - MixtourPro.PAD_BASE + 1; // 1-8
    var ch = "[Channel" + deck + "]";
    var pressed = value > 0;
    var mode = MixtourPro.state[deck].padMode;

    switch (mode) {
        case MixtourPro.MODE_HOTCUE:
        case MixtourPro.MODE_SAVED_LOOPS:
            // "Saved Loops" reuses hotcue_activate: Mixxx hotcues can natively store a
            // loop range, so the difference is what the DJ pre-programmed at the cue,
            // not a different engine control (LED tint is what distinguishes the mode).
            // SHIFT+pad is handled separately in padShiftPress below - the controller
            // sends a different note entirely while SHIFT is held, not the same note
            // with a modifier flag.
            if (pressed) {
                engine.setValue(ch, "hotcue_" + index + "_activate", 1);
            }
            break;

        case MixtourPro.MODE_BOUNCE_LOOP:
            engine.setValue(ch, "beatlooproll_" + MixtourPro.ROLL_SIZES[index - 1] + "_activate", pressed ? 1 : 0);
            break;

        case MixtourPro.MODE_PITCH_CUE:
            MixtourPro.pitchCuePad(ch, index, pressed);
            break;

        case MixtourPro.MODE_INSTANT_FX:
            MixtourPro.instantFxPad(deck, index, pressed);
            break;

        case MixtourPro.MODE_AUTO_LOOP:
            if (pressed) {
                engine.setValue(ch, "beatloop_" + MixtourPro.LOOP_SIZES[index - 1] + "_activate", 1);
            }
            break;

        case MixtourPro.MODE_SAMPLER:
            // Samplers are global in Mixxx (not per-deck), so Sampler-mode pads on any
            // deck hit the same 8 slots - intentional, matches how sampler banks work.
            if (pressed) {
                engine.setValue("[Sampler" + index + "]", "cue_gotoandplay", 1);
            }
            break;

        default:
            // Neural Mix (7): no Mixxx equivalent, intentionally unmapped.
            break;
    }
};

// Best-effort approximation of djay Pro's "Pitch Play" pads: jump to a hotcue and
// apply a temporary semitone offset for as long as the pad is held. Mixxx has no
// single native control for a trigger-and-revert pitched sample, so this is scripted.
MixtourPro.pitchCuePad = function(group, index, pressed) {
    if (pressed) {
        engine.setValue(group, "hotcue_" + index + "_activate", 1);
        engine.setValue(group, "pitch_adjust", MixtourPro.PITCH_CUE_SEMITONES[index - 1]);
    } else {
        engine.setValue(group, "pitch_adjust", 0);
    }
};

// SHIFT+pad: the controller sends notes 0x1C-0x23 (not 0x14-0x1B + a flag) while
// SHIFT is held, confirmed by hardware capture. Currently only defined for Hot Cue /
// Saved Loops (clear the hotcue); other modes have no documented SHIFT behavior yet
// and are intentionally left as no-ops rather than guessed.
MixtourPro.padShiftPress = function(channel, control, value, status, group) {
    if (value === 0) {
        return;
    }
    var deck = MixtourPro.deckFromStatus(status);
    var index = control - MixtourPro.PAD_SHIFT_BASE + 1; // 1-8
    var ch = "[Channel" + deck + "]";
    var mode = MixtourPro.state[deck].padMode;

    if (mode === MixtourPro.MODE_HOTCUE || mode === MixtourPro.MODE_SAVED_LOOPS) {
        engine.setValue(ch, "hotcue_" + index + "_clear", 1);
    }
};

// Momentary effect-unit toggle per pad. Only as many pads as the deck's effect unit
// has configured slots will do anything - the rest are harmless no-ops rather than
// fabricated bindings.
MixtourPro.instantFxPad = function(deck, index, pressed) {
    var effect = "[EffectRack1_EffectUnit" + deck + "_Effect" + index + "]";
    engine.setValue(effect, "enabled", pressed ? 1 : 0);
};

// -- IN>OUT>EX transport button: a single physical button that cycles loop_in ->
// loop_out -> reloop_exit, tracked per deck since Mixxx has no single control for it.
MixtourPro.loopInOutExit = function(channel, control, value, status, group) {
    if (value === 0) {
        return;
    }
    var deck = MixtourPro.deckFromStatus(status);
    var st = MixtourPro.state[deck];
    var ch = "[Channel" + deck + "]";

    if (st.loopStage === 0) {
        engine.setValue(ch, "loop_in", 1);
        st.loopStage = 1;
    } else if (st.loopStage === 1) {
        engine.setValue(ch, "loop_out", 1);
        st.loopStage = 2;
    } else {
        engine.setValue(ch, "reloop_exit", 1);
        st.loopStage = 0;
    }
};

// -- FX ON paddle: toggles both the unit's routing to this deck AND the first effect
// slot's own enabled state, so flipping it actually turns the effect on/off rather
// than just routing an effect that itself defaults to disabled.
MixtourPro.fxOnPaddle = function(channel, control, value, status, group) {
    var deck = MixtourPro.deckFromStatus(status);
    var on = value > 0 ? 1 : 0;
    engine.setValue("[EffectRack1_EffectUnit" + deck + "]", "group_[Channel" + deck + "]_enable", on);
    engine.setValue("[EffectRack1_EffectUnit" + deck + "_Effect1]", "enabled", on);
};

// -- MODE+PARAM< / MODE+PARAM>: hardware-encoded alternate notes (0x0A/0x0D) sent on
// that deck's own FX-unit channel while MODE is held, per the PDF's MODE-layer column
// for PARAM<>. Unlike the un-modified PARAM<> (which nudges super1 on all 4 units),
// this pages the effect chain preset for just the one deck whose MODE is held.
MixtourPro.fxChainPrevForDeck = function(channel, control, value, status, group) {
    if (value === 0) {
        return;
    }
    var deck = MixtourPro.deckFromStatus(status);
    engine.setValue("[EffectRack1_EffectUnit" + deck + "]", "prev_chain", 1);
};

MixtourPro.fxChainNextForDeck = function(channel, control, value, status, group) {
    if (value === 0) {
        return;
    }
    var deck = MixtourPro.deckFromStatus(status);
    engine.setValue("[EffectRack1_EffectUnit" + deck + "]", "next_chain", 1);
};

// -- Library browse encoder: normalize to exactly one row per detent regardless of
// the raw relative delta the encoder sends (a raw selectknob binding was passing
// that delta straight through to MoveVertical, causing multi-row jumps per click).
MixtourPro.browseEncoder = function(channel, control, value, status, group) {
    var direction = value < 0x40 ? -1 : 1;
    engine.setValue("[Library]", "MoveVertical", direction);
};

// -- FX dry/wet: hardware capture confirmed this is a single shared physical knob on
// the global channel (0xBF, CC 0x02), not one knob per deck as originally assumed -
// applies to all 4 effect units at once.
MixtourPro.fxMix = function(channel, control, value, status, group) {
    var mix = value / 127;
    for (var d = 1; d <= 4; d++) {
        engine.setValue("[EffectRack1_EffectUnit" + d + "]", "mix", mix);
    }
};

// -- PARAM< / PARAM>: hardware-confirmed on the global channel (0x9F, notes 0x03/0x04)
// alongside the shared FX dry/wet knob. Nudges the effect unit's super1 (macro/depth)
// parameter up or down a step - not next_chain/prev_chain, which swaps the loaded
// effect entirely rather than adjusting its control level.
MixtourPro.PARAM_STEP = 0.05;

MixtourPro.fxParamNudge = function(direction) {
    for (var d = 1; d <= 4; d++) {
        var group = "[EffectRack1_EffectUnit" + d + "]";
        var current = engine.getValue(group, "super1");
        var next = Math.max(0, Math.min(1, current + direction * MixtourPro.PARAM_STEP));
        engine.setValue(group, "super1", next);
    }
};

// Press-and-hold-to-repeat, same feel as the tempo nudge above: fires once
// immediately, then after the debounce delay keeps auto-repeating while held.
MixtourPro.fxParamTimers = {};

MixtourPro.fxParamHold = function(direction) {
    return function(channel, control, value, status, group) {
        var timerKey = "fxParam" + direction;

        if (value > 0) {
            MixtourPro.fxParamNudge(direction);

            MixtourPro.fxParamTimers[timerKey] = engine.beginTimer(MixtourPro.HOLD_REPEAT_DEBOUNCE_MS, function() {
                MixtourPro.fxParamTimers[timerKey] = engine.beginTimer(MixtourPro.HOLD_REPEAT_INTERVAL_MS, function() {
                    MixtourPro.fxParamNudge(direction);
                }, false);
            }, true);
        } else {
            var timerId = MixtourPro.fxParamTimers[timerKey];
            if (timerId) {
                engine.stopTimer(timerId);
                delete MixtourPro.fxParamTimers[timerKey];
            }
        }
    };
};

MixtourPro.fxParamDown = MixtourPro.fxParamHold(-1);
MixtourPro.fxParamUp = MixtourPro.fxParamHold(1);
