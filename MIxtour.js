# Mixxx Controller Mapping for Reloop Mixtour Pro (Enhanced)

*This version adds:
*- **Refined Pad Modes** (Hotcues, Loop, FX, Neural Mix)
*- **Full LED feedback** (RGB Pads + Transport Bi-LEDs)
*- **4‑Deck support** with dynamic deck selection

*---


*---
# MixtourPro.js
*javascript
var MixtourPro = {
    deck: 1,
    padMode: 0,
    shift: false,
    // Hotcue color palette
    hotcueColors: [0x03,0x0C,0x30,0x3F,0x3C,0x06,0x09,0x12]
};

MixtourPro.init = function() {
    print("Mixtour Pro enhanced mapping loaded (Shift Layers + Hotcue Colors)");
    MixtourPro.updatePadLEDsEnhanced();
};

MixtourPro.shiftButton = function(channel, control, value) {
    MixtourPro.shift = value>0;
    MixtourPro.updatePadLEDsEnhanced();
};

//--------------------------------------------------
// PAD PRESS HANDLER (WITH SHIFT LAYERS)
//--------------------------------------------------
MixtourPro.padPress = function(channel, control, value) {
    var index = control - 0x14 + 1;
    var deck = MixtourPro.deck;
    var group = `[Channel${deck}]`;

    if (MixtourPro.shift) {
        if (MixtourPro.padMode === 0) {
            if (value>0) engine.setValue(group, `hotcue_${index}_clear`,1);
            return;
        }
        if (MixtourPro.padMode === 1) {
            if(index===1 && value>0) engine.setValue(group,"loop_halve",1);
            if(index===2 && value>0) engine.setValue(group,"loop_double",1);
            return;
        }
        if (MixtourPro.padMode === 2) {
            if(value>0) engine.setValue(`[EffectRack1_EffectUnit1]`, `super1`, index/8);
            return;
        }
        if (MixtourPro.padMode === 3) {
            if(value>0){
                engine.setValue(group,"filterLowKill",0);
                engine.setValue(group,"filterMidKill",0);
                engine.setValue(group,"filterHighKill",0);
            }
            return;
        }
    }

    if (MixtourPro.padMode === 0) engine.setValue(group, `hotcue_${index}_activate`, value>0);
    else if (MixtourPro.padMode === 1) {
        if(index===1) engine.setValue(group,"loop_in",value>0);
        if(index===2) engine.setValue(group,"loop_out",value>0);
        if(index===3) engine.setValue(group,"reloop_exit",value>0);
        if(index===4) engine.setValue(group,"beatloop_activate",value>0);
    }
    else if (MixtourPro.padMode === 2) engine.setValue(`[EffectRack1_EffectUnit1]`, `group_${deck}_enable`, value>0);
    else if (MixtourPro.padMode === 3) {
        if(index===1) engine.setValue(group,"filterLowKill",value>0);
        if(index===2) engine.setValue(group,"filterMidKill",value>0);
        if(index===3) engine.setValue(group,"filterHighKill",value>0);
    }
};

//--------------------------------------------------
// ENHANCED LED FEEDBACK + HOTCUE COLORS
//--------------------------------------------------
MixtourPro.updatePadLEDsEnhanced = function() {
    var mode = MixtourPro.padMode;
    var colors = MixtourPro.RGB;

    for (var i=0;i<8;i++){
        var pad = 0x14+i;
        var color = colors.off;

        if(mode===0){
            var deck = MixtourPro.deck;
            var exists = engine.getValue(`[Channel${deck}]`,`hotcue_${i+1}_enabled`);
            color = exists ? MixtourPro.hotcueColors[i] : colors.blue;
            if(MixtourPro.shift && exists) color = colors.red;
        }
        else if(mode===1) color = colors.green;
        else if(mode===2) color = colors.yellow;
        else if(mode===3) color = colors.white;

        MixtourPro.sendLED(0x94,pad,color);
    }
};
