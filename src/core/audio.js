// Letter Launcher — src/core/audio.js
// Audio: WebAudio init, tones, noise buffers, rocket whoosh/boom, unlock, speech (yellWord) and zoo animal sounds.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // === LLF-Fix4: Synthesized rocket SFX (no external audio files) =======
        // Short white-noise buffer used by the whoosh/boom crackle.
        function makeNoiseBuffer(duration) {
            const sr = audioCtx.sampleRate;
            const buf = audioCtx.createBuffer(1, Math.max(1, Math.floor(sr * duration)), sr);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            return buf;
        }

        // Rising whistle + airy noise sweep — plays as a rocket lifts off.
        function playRocketWhoosh() {
            initAudio();
            if (!audioCtx || soundVolume <= 0) return;
            const now = audioCtx.currentTime;
            // Ascending sine whistle
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(1300, now + 1.4);
            const og = audioCtx.createGain();
            og.gain.setValueAtTime(0.0001, now);
            og.gain.exponentialRampToValueAtTime(0.12 * soundVolume, now + 0.15);
            og.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
            osc.connect(og); og.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 1.55);
            // Airy band-passed noise that opens up as it climbs
            const noise = audioCtx.createBufferSource();
            noise.buffer = makeNoiseBuffer(1.5);
            const bp = audioCtx.createBiquadFilter();
            bp.type = 'bandpass'; bp.Q.value = 0.8;
            bp.frequency.setValueAtTime(600, now);
            bp.frequency.exponentialRampToValueAtTime(3200, now + 1.4);
            const ng = audioCtx.createGain();
            ng.gain.setValueAtTime(0.0001, now);
            ng.gain.exponentialRampToValueAtTime(0.05 * soundVolume, now + 0.2);
            ng.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
            noise.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
            noise.start(now); noise.stop(now + 1.5);
        }

        // Low thump + high crackle — plays on detonation.
        function playRocketBoom() {
            initAudio();
            if (!audioCtx || soundVolume <= 0) return;
            const now = audioCtx.currentTime;
            // Descending low-frequency thump
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(170, now);
            osc.frequency.exponentialRampToValueAtTime(38, now + 0.35);
            const og = audioCtx.createGain();
            og.gain.setValueAtTime(0.5 * soundVolume, now);
            og.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc.connect(og); og.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.5);
            // High-passed noise crackle
            const noise = audioCtx.createBufferSource();
            noise.buffer = makeNoiseBuffer(0.6);
            const hp = audioCtx.createBiquadFilter();
            hp.type = 'highpass'; hp.frequency.value = 1100;
            const ng = audioCtx.createGain();
            ng.gain.setValueAtTime(0.3 * soundVolume, now + 0.02);
            ng.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
            noise.connect(hp); hp.connect(ng); ng.connect(audioCtx.destination);
            noise.start(now); noise.stop(now + 0.6);
        }

        // W3: Gate the Web Audio context behind a real user gesture so browsers never
        // emit an autoplay warning. The AudioContext is created lazily and resumed on
        // the first keydown / pointerdown, after which normal keystroke synthesis works.
        let audioUnlocked = false;
        function unlockAudio() {
            initAudio();
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
            audioUnlocked = true;
        }

    

        // Audio Context for Musical Keystroke Synthesis
        let audioCtx;
        function initAudio() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            // W3: a context created outside a user gesture starts 'suspended'; resume it
            // so no autoplay warning is logged and tones play once the user interacts.
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
            }
        }

        function playTone(char, position) {
            initAudio();
            if (!audioCtx) return;

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const panner = audioCtx.createPanner();

            // Unique frequency based on letter (A=440Hz, others stepped by semitones)
            const code = char.charCodeAt(0) - 65; // A=0, B=1...
            const freq = 440 * Math.pow(2, (code - 9) / 12);
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

            // Spatial positioning
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            if (position) {
                panner.positionX.setValueAtTime(position.x, audioCtx.currentTime);
                panner.positionY.setValueAtTime(position.y, audioCtx.currentTime);
                panner.positionZ.setValueAtTime(position.z, audioCtx.currentTime);
            }

            osc.connect(panner);
            panner.connect(gain);
            gain.connect(audioCtx.destination);

            const now = audioCtx.currentTime;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.2 * soundVolume, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 1);

            osc.start(now);
            osc.stop(now + 1);
        }

        function yellWord(word) {
            initAudio();
            if (!audioCtx) return;
            const msg = new SpeechSynthesisUtterance(word);
            msg.rate = 1.2;
            msg.pitch = 1.5;
            msg.volume = soundVolume;
            window.speechSynthesis.speak(msg);
        }

        function playZooAnimalSound(animal) {
            initAudio();
            if (!audioCtx) return;
            const now = audioCtx.currentTime;
            
            if (animal === 'LION') {
                // Low frequency growl/roar
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.exponentialRampToValueAtTime(40, now + 1);
                
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.3 * soundVolume, now + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);
                
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1.5);
            } else if (animal === 'ELEPHANT') {
                // High frequency trumpet
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.linearRampToValueAtTime(600, now + 0.2);
                osc.frequency.exponentialRampToValueAtTime(400, now + 0.8);
                
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.2 * soundVolume, now + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1);
                
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1);
            } else if (animal === 'MONKEY') {
                // Quick chirps
                for (let i = 0; i < 3; i++) {
                    const t = now + i * 0.2;
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.frequency.setValueAtTime(800 + Math.random() * 400, t);
                    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
                    gain.gain.setValueAtTime(0.1 * soundVolume, t);
                    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start(t);
                    osc.stop(t + 0.15);
                }
            } else if (animal === 'GIRAFFE') {
                // Low hum
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(60, now);
                osc.frequency.linearRampToValueAtTime(70, now + 1);
                gain.gain.setValueAtTime(0.1 * soundVolume, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 1);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 1);
            } else {
                yellWord(animal);
            }
        }
